'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { mediaLoadQueue } from '@/lib/gallery/load-queue.ts'

/**
 * One tile's picture, fetched in turn rather than all at once.
 *
 * Three things happen here, and they are separable:
 *
 *  1. **Every tile is served in document order, a few at a time**, by
 *     `lib/gallery/load-queue.ts`. This is the part that makes the grid fill
 *     top-to-bottom instead of arriving in one late block.
 *  2. **What is near the viewport goes first.** An `IntersectionObserver`
 *     PROMOTES a tile from the back of the queue to its natural position, so a
 *     page you never scroll spends its bandwidth on the rows you can see.
 *  3. **A tile shows a shimmer until its own bytes decode**, then fades in. The
 *     grid is therefore visibly working from the first frame, which is the
 *     difference between "slow" and "loading".
 *
 * ## Why the observer promotes rather than gates
 *
 * Gating on it was the first design, and it is the kind of thing that works
 * until it silently does not: an observer delivers nothing at all in a tab that
 * is never composited, and a tile whose callback never fires would then never
 * load — a permanently shimmering rectangle with no error to explain it. Queue
 * everything and let the observer reorder, and the worst case is a tile that
 * loads later than it might have, which is a delay rather than a hole.
 *
 * ## The first row is exempt, deliberately
 *
 * A queued tile cannot start until React has hydrated, and hydration is strictly
 * later than HTML parsing — so putting EVERY tile behind the queue would make
 * the first picture arrive later than it does today. The tiles that are
 * certainly on screen (`eager`) therefore keep their `src` in the server-rendered
 * markup and start downloading during parse, exactly as before. The queue only
 * ever governs the long tail, which is the part that was competing with them.
 *
 * ## Without JavaScript
 *
 * The `<noscript>` twin keeps the gallery a working page rather than a grid of
 * shimmering rectangles. It costs nothing when scripting is on.
 */

/**
 * How early a tile is promoted, in CSS pixels beyond the viewport.
 *
 * Generous on purpose: a queued tile has a wait ahead of it, so promoting it at
 * the moment it becomes visible is already too late. Roughly two rows.
 */
const NEAR_VIEWPORT = '800px 0px'

/**
 * What a tile's priority is worth before the observer has seen it.
 *
 * Far larger than any page can hold (`MAX_PAGE_SIZE` is 200), so an unpromoted
 * tile always sorts behind every promoted one while still keeping its own
 * position relative to its unpromoted neighbours.
 */
const DEFERRED = 1_000_000

/**
 * The longest a tile may hold a slot without resolving.
 *
 * A stalled connection fires neither `load` nor `error` — it simply hangs — and
 * four hung tiles would wedge the queue for the rest of the page. The fetch is
 * left running when this fires; only the SLOT is handed back, so a late arrival
 * still paints.
 */
const SLOT_TIMEOUT_MS = 15_000

export interface LazyMediaProps {
  src: string
  kind: 'image' | 'video'
  /**
   * Position in the grid. Lower loads first — pass the index the tile is
   * rendered at so the order on screen and the order on the wire agree.
   */
  priority: number
  /**
   * Skip the queue and render the `src` straight into the markup. For the tiles
   * that are certainly above the fold — see the note above.
   */
  eager?: boolean
  className?: string
  /** Video only: play on hover, per docs/UX-SPEC.md. */
  onHoverPlay?: boolean
}

type Phase = 'waiting' | 'fetching' | 'shown' | 'failed'

export function LazyMedia({
  src,
  kind,
  priority,
  eager = false,
  className = 'h-full w-full object-cover',
  onHoverPlay = false,
}: LazyMediaProps) {
  const holder = useRef<HTMLSpanElement>(null)
  const image = useRef<HTMLImageElement>(null)

  // An eager tile is already fetching in the server-rendered markup, so it must
  // start in `fetching` — starting it in `waiting` would render a src-less tag
  // on the client and throw away the download the parser had already begun.
  const [phase, setPhase] = useState<Phase>(eager ? 'fetching' : 'waiting')

  const granted = useRef(false)
  const release = useRef<(() => void) | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /**
   * Hand the slot back. Idempotent, and safe before a grant or after one — the
   * queue treats an ungranted release as a cancellation.
   */
  const settle = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = undefined
    }
    release.current?.()
    release.current = undefined
  }, [])

  /**
   * Take a place in the queue, replacing any place already held.
   *
   * A no-op once the slot has been granted: re-queueing then would hand back a
   * fetch already in flight and start a second one for the same bytes.
   */
  const enqueue = useCallback(
    (priority: number) => {
      if (granted.current) return
      release.current?.()
      release.current = mediaLoadQueue.request(priority, () => {
        granted.current = true
        // The slot is held from here until the element reports back, or until
        // SLOT_TIMEOUT_MS decides it never will.
        timer.current = setTimeout(settle, SLOT_TIMEOUT_MS)
        setPhase('fetching')
      })
    },
    [settle],
  )

  /*
   * Join the queue at once, at the back; move up when the observer says the
   * tile is worth looking at. See the note at the top of this file for why that
   * order matters more than it looks.
   */
  useEffect(() => {
    if (eager) return
    enqueue(priority + DEFERRED)

    const node = holder.current
    if (!node || typeof IntersectionObserver === 'undefined') return settle

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        enqueue(priority)
      },
      { rootMargin: NEAR_VIEWPORT },
    )
    observer.observe(node)

    return () => {
      observer.disconnect()
      settle()
    }
  }, [eager, priority, enqueue, settle])

  /*
   * An image already in the HTTP cache can finish before React attaches its
   * `load` handler, and the event is then never seen — the tile would sit at
   * `opacity-0` holding a queue slot until the timeout. `complete` is the
   * authoritative answer, so it is checked on every commit while fetching.
   */
  useEffect(() => {
    if (phase !== 'fetching' || kind !== 'image') return
    const node = image.current
    if (!node?.complete) return
    setPhase(node.naturalWidth > 0 ? 'shown' : 'failed')
    settle()
  })

  // One path for both outcomes: the queue does not care whether a tile
  // succeeded, only that it stopped occupying a slot.
  const finish = (next: Phase) => () => {
    setPhase(next)
    settle()
  }

  const armed = phase !== 'waiting'
  const shown = phase === 'shown'
  const fade = `${className} transition-opacity duration-(--dur) ${
    shown ? 'opacity-100' : 'opacity-0'
  }`

  return (
    <span ref={holder} className="relative block h-full w-full">
      {/* The shimmer sits behind the media and is simply covered once it paints
          — cross-fading two layers would show the page background through the
          gap at every tile. It is dropped on failure so the card's own
          placeholder is what shows through. */}
      {!shown && phase !== 'failed' && (
        <span
          aria-hidden
          className="absolute inset-0 block animate-pulse bg-(--color-surface-hover)"
        />
      )}

      {kind === 'video' ? (
        <video
          src={armed ? src : undefined}
          muted
          loop
          playsInline
          // `metadata`, not `auto`: a grid of 48 videos must not become 48 whole
          // files. The queue governs WHEN this starts; preload governs how much.
          preload="metadata"
          className={fade}
          onLoadedMetadata={finish('shown')}
          onError={finish('failed')}
          {...(onHoverPlay
            ? {
                onMouseEnter: (event: React.MouseEvent<HTMLVideoElement>) =>
                  void event.currentTarget.play().catch(() => undefined),
                onMouseLeave: (event: React.MouseEvent<HTMLVideoElement>) => {
                  event.currentTarget.pause()
                  event.currentTarget.currentTime = 0
                },
              }
            : {})}
        />
      ) : (
        <img
          ref={image}
          src={armed ? src : undefined}
          alt=""
          // Kept alongside the queue rather than replaced by it: `lazy` is the
          // browser's own answer to "is this worth fetching at all", and it
          // still applies once the queue has released the tile.
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          decoding="async"
          className={fade}
          onLoad={finish('shown')}
          onError={finish('failed')}
        />
      )}

      {/* Scripting off: the ordinary tag, with the ordinary src. */}
      <noscript>
        {kind === 'video' ? (
          <video src={src} muted loop playsInline preload="metadata" className={className} />
        ) : (
          <img src={src} alt="" className={className} />
        )}
      </noscript>
    </span>
  )
}
