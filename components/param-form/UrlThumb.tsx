'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Alert, Close, Film, Image as ImageIcon, Wave } from '@/components/shell/icons.tsx'
import { extensionFromUrl } from '@/lib/jobs/paths.ts'
import type { AssetKind, ParamDef } from '@/lib/kie/registry/types.ts'

/**
 * A picture of what is actually in this slot.
 *
 * The field it sits in holds a URL, and a URL is the one thing about an image
 * that tells you nothing about the image. With several of them the list becomes
 * unreadable in a specific, costly way: marking up the second of four pictures
 * changes two rows at once — the marked copy replaces the original, and the
 * clean original is kept alongside it — and if every row is a 90-character
 * signed URL, the only way to know which is which is to open each one.
 *
 * So each row gets a thumbnail, numbered, and the order becomes something you
 * read rather than reconstruct.
 *
 * Its size comes from `--asset-control` in globals.css, which every other
 * control on the row is also measured against — see `.asset-row` there. The
 * thumbnail is what sets that number: below about 40px a photograph stops being
 * recognisable, and recognising it is the whole job.
 *
 * ## Two ways to see it bigger, for two kinds of device
 *
 * | input | what happens |
 * |---|---|
 * | hover, on a device that has one | a floating preview beside the row |
 * | click or tap, anywhere | a full-screen viewer |
 *
 * The hover half is gated on `(hover: hover)` rather than on a user-agent guess.
 * A touch device reports `hover: none`, and without the gate its synthesised
 * mouseover leaves a preview stuck on screen that nothing will ever dismiss —
 * so the tap opens the viewer and the hover never fires at all.
 *
 * ## Where the pixels come from: the URL first, then us
 *
 * The `<img>` points straight at the field's own URL. These are already public
 * and already on a CDN — a Kie `downloadUrl`, or something pasted — so it costs
 * this app nothing and is the fastest path a thumbnail can take. Proxying by
 * default is what made the markup editor's own image slow to open (measured in
 * `objectStream`), and there is no reason to repeat that for a 40-pixel square.
 *
 * Two things make a direct load fail, though, and neither means the picture is
 * gone:
 *
 *   - **The host refuses to be hotlinked.** Some do, by `Referer`. Wikimedia is
 *     one, which is how this was found.
 *   - **A Kie URL has passed its ~24 hours.** The bytes are still ours — every
 *     upload keeps a copy in the bucket precisely for this.
 *
 * So a failed direct load falls back to `/api/annotate/source`, which resolves
 * the URL against this workspace's own rows and streams the stored copy when it
 * finds one (and fetches it under the SSRF guard when it does not). Only after
 * BOTH fail is the slot drawn as broken — which by then is the honest answer,
 * because the same URL is what would be sent to the model.
 */

/** The hover preview's longest edge. */
const PREVIEW_PX = 260

export function UrlThumb({
  url,
  param,
  index,
}: {
  url: string
  param: ParamDef
  /** 1-based position, shown as a badge. Omitted for a single-value field. */
  index?: number
}) {
  const [hovering, setHovering] = useState(false)
  const [viewing, setViewing] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)

  const trimmed = url.trim()
  const kind = kindOf(trimmed, param)
  const { src, failed, onError } = useImageSource(trimmed)

  const canHover = useHoverCapable()

  if (!trimmed) {
    return (
      <div
        className="asset-thumb flex shrink-0 items-center justify-center rounded-md border border-dashed border-(--color-border) text-(--color-ink-faint)"
        aria-hidden
      >
        <ImageIcon size={14} />
      </div>
    )
  }

  const showable = kind === 'image' && !failed

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setViewing(true)}
        onMouseEnter={() => canHover && setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={() => canHover && setHovering(true)}
        onBlur={() => setHovering(false)}
        title={index ? `Image ${index} — click to view full size` : 'Click to view full size'}
        aria-label={index ? `View image ${index} full size` : 'View image full size'}
        className="asset-thumb relative shrink-0 overflow-hidden rounded-md border border-(--color-border) bg-(--color-surface-raised) transition-colors duration-(--dur-fast) hover:border-(--color-accent-line) focus-visible:border-(--color-accent-line)"
      >
        {showable ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={onError}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-(--color-ink-faint)">
            {failed ? <Alert size={14} /> : <KindIcon kind={kind} />}
          </span>
        )}

        {/*
          The number, and the reason the whole component exists. Bottom-left so
          it never covers a face, and on its own scrim so it stays readable over
          a white sky as well as a dark one.
        */}
        {index !== undefined && (
          <span className="absolute bottom-0 left-0 rounded-tr-md bg-black/65 px-1 text-[9px] leading-[1.35] font-medium text-white tabular-nums">
            {index}
          </span>
        )}
      </button>

      {hovering && !viewing && showable && <HoverPreview anchor={anchor} url={src} />}
      {viewing && (
        <Viewer url={src} rawUrl={trimmed} kind={kind} onClose={() => setViewing(false)} />
      )}
    </>
  )
}

/**
 * The floating preview.
 *
 * Fixed-positioned from the thumbnail's own rect rather than absolutely
 * positioned inside the row. The row lives in a form that scrolls, and inside a
 * panel that can clip — an absolutely positioned preview is cropped by the first
 * ancestor with `overflow` set, which is exactly the case it is needed in.
 */
function HoverPreview({
  anchor,
  url,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>
  url: string
}) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const element = anchor.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const gap = 8

    // Flipped to the left when there is no room on the right, and clamped
    // vertically, so the preview is never half off the screen.
    const left =
      rect.right + gap + PREVIEW_PX > window.innerWidth
        ? Math.max(gap, rect.left - gap - PREVIEW_PX)
        : rect.right + gap
    const top = Math.min(
      Math.max(gap, rect.top + rect.height / 2 - PREVIEW_PX / 2),
      Math.max(gap, window.innerHeight - PREVIEW_PX - gap),
    )
    setAt({ left, top })
  }, [anchor])

  if (typeof document === 'undefined' || !at) return null

  return createPortal(
    <div
      className="pointer-events-none fixed z-50 overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface-raised) p-1 shadow-[var(--shadow-lg)]"
      style={{ left: at.left, top: at.top }}
      role="presentation"
    >
      <img
        src={url}
        alt=""
        className="block rounded-md object-contain"
        style={{ maxWidth: PREVIEW_PX, maxHeight: PREVIEW_PX }}
      />
    </div>,
    document.body,
  )
}

/**
 * The full-screen viewer — the touch half of the feature, and the keyboard one.
 *
 * A dialog rather than a bigger hover card because on a phone there is no hover
 * to hang one off, and because at that size the thing you want is the whole
 * picture, not a slightly larger square.
 */
function Viewer({
  url,
  rawUrl,
  kind,
  onClose,
}: {
  /** What to load — possibly our proxy, if the direct load failed. */
  url: string
  /** What to SHOW as text: the value in the field, which is what a model gets. */
  rawUrl: string
  kind: AssetKind
  onClose: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Full size preview"
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-(--color-bg)/90 p-4 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="btn btn-ghost btn-sm btn-icon absolute top-3 right-3"
      >
        <Close size={14} />
      </button>

      {kind === 'video' ? (
        <video
          src={url}
          controls
          // The backdrop closes on click; the media must not.
          onClick={(event) => event.stopPropagation()}
          className="max-h-[80vh] max-w-full rounded-lg"
        />
      ) : kind === 'audio' ? (
        <audio
          src={url}
          controls
          onClick={(event) => event.stopPropagation()}
          className="w-full max-w-md"
        />
      ) : (
        <img
          src={url}
          alt=""
          onClick={(event) => event.stopPropagation()}
          className="max-h-[80vh] max-w-full rounded-lg object-contain"
        />
      )}

      {/*
        The URL is still worth showing. It is what actually goes to the model,
        and seeing it next to the picture is how you confirm the right row was
        the one you were looking at.
      */}
      <p
        onClick={(event) => event.stopPropagation()}
        className="max-w-full truncate font-mono text-[11px] text-(--color-ink-muted)"
        title={rawUrl}
      >
        {rawUrl}
      </p>
    </div>,
    document.body,
  )
}

// ------------------------------------------------------------------- helpers

/**
 * The thumbnail's source, escalating from the URL itself to our own proxy.
 *
 * Three states, in order, and the URL only reaches the last one when both of the
 * first two have actually failed to decode in the browser:
 *
 * | stage | src | covers |
 * |---|---|---|
 * | `direct` | the field's URL | everything that is live and hotlinkable |
 * | `proxied` | `/api/annotate/source?url=` | hotlink-blocked hosts, and expired Kie URLs whose bytes we still hold |
 * | `failed` | — | genuinely gone |
 *
 * Keyed on the URL so that editing the field starts the escalation over: a slot
 * that failed a second ago is not evidence about the URL just typed into it.
 */
function useImageSource(url: string): {
  src: string
  failed: boolean
  onError: () => void
} {
  const [stage, setStage] = useState<'direct' | 'proxied' | 'failed'>('direct')

  useEffect(() => setStage('direct'), [url])

  const onError = useCallback(() => {
    setStage((current) => (current === 'direct' ? 'proxied' : 'failed'))
  }, [])

  return {
    src: stage === 'proxied' ? `/api/annotate/source?url=${encodeURIComponent(url)}` : url,
    failed: stage === 'failed',
    onError,
  }
}

/**
 * Whether this device has a pointer that can hover.
 *
 * Read from the media query rather than from the user agent, and re-read when it
 * changes — a tablet with a keyboard attached and then removed is one device
 * that answers both ways in a session.
 */
function useHoverCapable(): boolean {
  const [capable, setCapable] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(hover: hover)')
    const apply = () => setCapable(query.matches)
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])

  return capable
}

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'])

/**
 * What this URL is, extension first and the field's own `accept` second.
 *
 * The extension wins because a field that accepts both an image and a video says
 * nothing about which one is in it. `accept` is the fallback for the common Kie
 * URL that carries no extension at all, and `image` is the last resort because
 * an `<img>` that turns out to be wrong degrades to the broken-file state, while
 * a `<video>` pointed at a PNG shows an empty black box.
 */
function kindOf(url: string, param: ParamDef): AssetKind {
  const ext = extensionFromUrl(url)
  if (ext) {
    if (IMAGE_EXTENSIONS.has(ext)) return 'image'
    if (VIDEO_EXTENSIONS.has(ext)) return 'video'
    if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  }

  const accept = param.accept ?? []
  if (accept.length === 1 && accept[0] !== 'file') return accept[0]!
  if (accept.includes('image')) return 'image'
  if (accept.includes('video')) return 'video'
  if (accept.includes('audio')) return 'audio'
  return 'image'
}

function KindIcon({ kind }: { kind: AssetKind }) {
  if (kind === 'video') return <Film size={14} />
  if (kind === 'audio') return <Wave size={14} />
  return <ImageIcon size={14} />
}
