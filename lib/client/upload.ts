'use client'

import { ApiError, studioFetch } from './api.ts'

/**
 * The one way a file gets from this browser to a model.
 *
 * It exists because of a failure with no server-side fix. A serverless
 * platform caps the REQUEST body of a function — 4.5 MB on Vercel — and
 * enforces it at the edge, before the route runs. Nothing in `app/api/upload`
 * ever sees the request; the browser gets back a plain-text
 * `Request Entity Too Large`, and a caller that went straight to `.json()` on it
 * reported `Unexpected token 'R', "Request En"... is not valid JSON` — an error
 * about a parser, naming neither the file, nor the size, nor the limit.
 *
 * Two things went wrong there and both are fixed here.
 *
 *   1. **The size.** Anything past the threshold goes to the bucket directly,
 *      over a signed URL minted by `POST /api/upload/ticket`, and only the KEY
 *      is sent through a function afterwards. The platform's body cap stops
 *      applying because no function is carrying the body. A marked-up 4K
 *      screenshot flattened to PNG — routinely 8-15 MB — uploads the same way a
 *      small one does.
 *   2. **The message.** Every call goes through `studioFetch`, which already
 *      turns a non-JSON body into an `ApiError` carrying the text. A 413 that
 *      slips through anyway now says so in words.
 *
 * Small files keep the single-round-trip multipart path. It is the one that has
 * always worked, it is a third of the requests, and a threshold that routed
 * everything through three calls to fix a problem most files do not have would
 * be a worse trade.
 */

/**
 * Above this, a file takes the direct-to-bucket path.
 *
 * Vercel's documented request-body limit is 4.5 MB and it counts the whole
 * multipart envelope, not just the file — so the threshold sits below it with
 * room for the boundary, the field names, and the annotation document riding
 * along in the same body. Other hosts have their own limits; this one is the
 * lowest among the ones this app is deployed to, so it is the one that binds.
 */
export const DIRECT_UPLOAD_THRESHOLD = 3.5 * 1024 * 1024

export interface UploadedInput {
  /** The value to put in the model's `*_url` field. */
  fileUrl: string
  /** The `input_assets` row id. */
  id: string
  kind: string
  mime?: string
  bytes: number
  expiresAt: number
  /** True when this cost no upload — the same bytes were already live. */
  reused: boolean
}

export interface UploadOptions {
  /** Shown in the asset library. Defaults to the filename. */
  label?: string
  /** The markup document these bytes were flattened from, when there is one. */
  annotation?: { doc: unknown; sourceAssetId: string | null }
  /** 0-1, reported while bytes are actually moving. */
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/**
 * Uploads a file and returns the `fileUrl` a model can read.
 *
 * Throws `ApiError` with the route's own message on failure, like every other
 * call in `lib/client/api.ts`.
 */
export async function uploadInput(
  file: File | Blob,
  filename: string,
  options: UploadOptions = {},
): Promise<UploadedInput> {
  const mime = file.type || undefined
  const small = file.size <= DIRECT_UPLOAD_THRESHOLD

  // The hash is what makes the direct path content-addressed, and `crypto.subtle`
  // needs a secure context. Localhost and https both qualify; anything else
  // falls back, and only then does the size limit bite again.
  const sha256 = small ? null : await sha256Hex(file)

  if (small || !sha256) {
    return uploadMultipart(file, filename, mime, options)
  }
  return uploadDirect(file, filename, mime, sha256, options)
}

// ------------------------------------------------------------------ the paths

/** One round trip. Everything rides in the request body. */
async function uploadMultipart(
  file: File | Blob,
  filename: string,
  mime: string | undefined,
  options: UploadOptions,
): Promise<UploadedInput> {
  const body = new FormData()
  body.append('file', file instanceof File ? file : new File([file], filename, { type: mime }))
  if (options.label) body.append('label', options.label)
  if (options.annotation) body.append('annotation', JSON.stringify(options.annotation))

  options.onProgress?.(0)
  const result = await studioFetch<UploadedInput>('/api/upload', {
    method: 'POST',
    body,
    signal: options.signal,
  })
  options.onProgress?.(1)
  return check(result)
}

/**
 * Three round trips, no function ever holding the bytes.
 *
 * Ticket, then a PUT straight at Supabase, then a finalize carrying the key.
 * The middle call is the only one that does not go through `studioFetch`: it is
 * addressed to another origin entirely, and attaching this app's Kie key to a
 * request leaving for one would be the exact thing rule 3 forbids.
 */
async function uploadDirect(
  file: File | Blob,
  filename: string,
  mime: string | undefined,
  sha256: string,
  options: UploadOptions,
): Promise<UploadedInput> {
  const ticket = await studioFetch<{
    storageKey: string
    uploadUrl: string
    alreadyStored: boolean
  }>('/api/upload/ticket', {
    method: 'POST',
    body: { sha256, bytes: file.size, mime, filename },
    signal: options.signal,
  })

  if (ticket.alreadyStored) {
    // The bucket has these exact bytes under this exact key — content addressing
    // is what lets that be known without reading the object. Nothing to send.
    options.onProgress?.(1)
  } else {
    await putBytes(ticket.uploadUrl, file, mime, options)
  }

  return check(
    await studioFetch<UploadedInput>('/api/upload', {
      method: 'POST',
      body: {
        storageKey: ticket.storageKey,
        sha256,
        filename,
        mime,
        label: options.label,
        annotation: options.annotation,
      },
      signal: options.signal,
    }),
  )
}

/**
 * The transfer itself, over XHR rather than fetch.
 *
 * Purely for `upload.onprogress`. This is the one request in the app that can
 * take a minute on a bad connection, and a button that says "Uploading…" with
 * nothing moving for forty seconds is one people press again — which starts a
 * second transfer of the same file.
 *
 * The body is a multipart form with the blob under an EMPTY field name, which
 * looks like a mistake and is not: it is byte-for-byte what
 * `supabase-js`'s own `uploadToSignedUrl` sends for a Blob, and this is a wire
 * format belonging to another service. Matching the reference client is the
 * only way to be sure of it, because supabase-js is `server-only` here — the
 * bucket is opened with a service-role key and cannot be handed to a browser —
 * so this request has to be written out by hand.
 */
function putBytes(
  uploadUrl: string,
  file: File | Blob,
  mime: string | undefined,
  options: UploadOptions,
): Promise<void> {
  const body = new FormData()
  // Matches what `putObject` writes server-side. The object is served through
  // signed URLs that expire sooner than this anyway.
  body.append('cacheControl', '3600')
  body.append('', mime && !file.type ? new Blob([file], { type: mime }) : file)

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', uploadUrl, true)
    // No content-type header: the browser has to set the multipart boundary,
    // and naming the type here would overwrite it with something unparseable.
    //
    // The key already exists whenever the same file was added before, and a
    // content-addressed key holding identical bytes is not a collision.
    request.setRequestHeader('x-upsert', 'true')

    const onAbort = () => request.abort()
    options.signal?.addEventListener('abort', onAbort)
    const done = () => options.signal?.removeEventListener('abort', onAbort)

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total)
    }
    request.onload = () => {
      done()
      if (request.status >= 200 && request.status < 300) {
        options.onProgress?.(1)
        resolve()
        return
      }
      reject(
        new ApiError(
          request.status,
          'The file could not be stored.',
          // Supabase answers with JSON; whatever it says is more useful than a
          // status code, and it is quoted rather than interpreted because this
          // is another service's error, not ours.
          summarize(request.responseText) ?? `Storage answered ${request.status}.`,
        ),
      )
    }
    request.onerror = () => {
      done()
      reject(
        new ApiError(
          0,
          'The upload could not reach storage.',
          'Check the connection and try again — nothing was saved.',
        ),
      )
    }
    request.onabort = () => {
      done()
      reject(new DOMException('Upload cancelled.', 'AbortError'))
    }

    request.send(body)
  })
}

// ---------------------------------------------------------------- the details

/**
 * SHA-256 of the file, hex.
 *
 * Returns null rather than throwing when `crypto.subtle` is missing — an
 * insecure context, essentially — because the caller has a working fallback and
 * a missing hash is not a reason to refuse an upload.
 */
async function sha256Hex(file: File | Blob): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

/**
 * A 200 that carries no URL is the worst shape this can come back in: the value
 * goes into the field as `undefined`, is filtered straight back out, and the
 * file appears to have vanished with no error anywhere.
 */
function check(result: UploadedInput): UploadedInput {
  if (typeof result?.fileUrl !== 'string' || !result.fileUrl) {
    throw new ApiError(200, 'The file was stored but came back without a URL.')
  }
  return result
}

/** The useful sentence out of another service's error body, if there is one. */
function summarize(text: string): string | undefined {
  if (!text) return undefined
  try {
    const parsed = JSON.parse(text) as { message?: string; error?: string }
    const message = parsed.message ?? parsed.error
    if (typeof message === 'string' && message) return message
  } catch {
    // Not JSON. The text itself is the best available answer.
  }
  return text.slice(0, 200)
}
