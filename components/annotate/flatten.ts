import { renderTo, type AnnotationDoc } from '@/lib/annotate/doc.ts'

/**
 * Turning marks into pixels a model can actually read.
 *
 * No endpoint in scope takes a mask, so the annotation has to BE part of the
 * image. This renders the source at its own natural resolution and replays the
 * document over it — the same `renderTo` the on-screen preview calls, at a
 * different scale. That shared call is the check that the normalized geometry is
 * right: if the 600px preview and the 4000px upload disagree, the bug is in the
 * document, not in one of two drawing routines.
 */

/**
 * Beyond this a PNG is refused and the export retries as JPEG.
 *
 * Below the 50 MB Supabase Free ceiling on purpose. The server will reject
 * anything past its own limit with a clear message, but discovering that after
 * uploading 48 MB is a slow way to learn it, and a photograph re-encoded as PNG
 * routinely lands five to ten times its original size.
 */
const PNG_CEILING_BYTES = 40 * 1024 * 1024

export interface Flattened {
  blob: Blob
  filename: string
  /** Set when the chosen format was not the first choice, so the UI can say why. */
  note?: string
}

/**
 * Draws `doc` onto `image` and encodes the result.
 *
 * Format follows the source rather than always reaching for PNG. A JPEG
 * photograph re-encoded losslessly gains nothing — its detail is already gone —
 * and costs several times the bytes, against a 1 GB total budget. Anything else
 * stays PNG, because a screenshot, a logo or a flat-colour graphic is exactly
 * what JPEG ringing damages most, and those are the images whose crisp edges a
 * model is being asked to preserve.
 */
export async function flatten(
  image: HTMLImageElement,
  doc: AnnotationDoc,
  sourceMime: string | undefined,
  baseName = 'markup',
): Promise<Flattened> {
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (!width || !height) throw new Error('That image has not finished loading.')

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser would not provide a 2D canvas.')

  ctx.drawImage(image, 0, 0, width, height)
  renderTo(ctx, doc, { w: width, h: height })

  const preferJpeg = (sourceMime ?? '').includes('jpeg') || (sourceMime ?? '').includes('jpg')

  if (preferJpeg) {
    return {
      blob: await encode(canvas, 'image/jpeg', 0.92),
      filename: `${baseName}.jpg`,
    }
  }

  const png = await encode(canvas, 'image/png')
  if (png.size <= PNG_CEILING_BYTES) {
    return { blob: png, filename: `${baseName}.png` }
  }

  // Said out loud rather than swapped silently: a lossless export turning lossy
  // is exactly the kind of thing someone needs to know before they upscale it.
  return {
    blob: await encode(canvas, 'image/jpeg', 0.92),
    filename: `${baseName}.jpg`,
    note:
      `A PNG of this image came to ${mb(png.size)} MB, past what can be stored. ` +
      'It was saved as a high-quality JPEG instead.',
  }
}

/**
 * `toBlob` rather than `toDataURL`.
 *
 * A data URI is base64, which inflates the payload by a third for no benefit
 * when the destination is a multipart upload that takes bytes anyway. The
 * callback form is wrapped because `toBlob` has no promise overload.
 *
 * A null blob here is the tainted-canvas failure, which is the whole reason
 * `/api/annotate/source` exists — so it gets a message that names the cause
 * instead of "export failed".
 */
function encode(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else {
          reject(
            new Error(
              'The marked-up image could not be read back off the canvas. That usually ' +
                'means the source image was loaded from another origin.',
            ),
          )
        }
      },
      mime,
      quality,
    )
  })
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}
