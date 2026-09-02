'use client'

import Link from 'next/link'
import { useState } from 'react'

import {
  assetHref,
  formatTimestamp,
  isInFlight,
  promptOf,
  stateLabel,
  stateTone,
} from '@/lib/gallery/display.ts'

/**
 * One tile in the gallery grid.
 *
 * A failed generation gets a card showing its `failCode` and `failMsg`, not a
 * gap in the grid (docs/UX-SPEC.md). A failure you can read is worth more than
 * a clean grid — it is usually a moderation message, and it is the only clue to
 * what tripped it.
 */

export interface CardAsset {
  kind: 'image' | 'video' | 'audio'
  localPath: string
  width: number | null
  height: number | null
  /** Present only for a private generation, minted by the page that rendered it. */
  token?: string
}

export interface CardGeneration {
  id: string
  modelSlug: string
  family: string
  state: string
  favorite: boolean
  /** Marked private. Only ever reaches a card when the NSFW filter is on. */
  nsfw?: boolean
  failCode: string | null
  failMsg: string | null
  createdAt: number
  input: unknown
}

export function GenerationCard({
  generation,
  thumbnail,
  assetCount,
}: {
  generation: CardGeneration
  thumbnail?: CardAsset
  assetCount: number
}) {
  const [favorite, setFavorite] = useState(generation.favorite)
  const [saving, setSaving] = useState(false)
  const prompt = promptOf(generation.input)

  const toggleFavorite = async (event: React.MouseEvent) => {
    // The whole tile is a link; the star must not navigate.
    event.preventDefault()
    event.stopPropagation()

    const next = !favorite
    setFavorite(next)
    setSaving(true)
    try {
      const response = await fetch(`/api/generations/${generation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorite: next }),
      })
      if (!response.ok) throw new Error('failed')
    } catch {
      setFavorite(!next) // put it back rather than lie about what was saved
    } finally {
      setSaving(false)
    }
  }

  return (
    <Link
      href={`/gallery/${generation.id}`}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface-raised) transition hover:border-(--color-ink-muted)"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-black">
        {thumbnail ? (
          <Preview asset={thumbnail} />
        ) : (
          <Placeholder generation={generation} />
        )}

        <button
          type="button"
          onClick={toggleFavorite}
          disabled={saving}
          aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={favorite}
          className={`absolute top-2 right-2 rounded-full border px-2 py-1 text-xs backdrop-blur transition ${
            favorite
              ? 'border-amber-300/60 bg-black/50 text-amber-300'
              : 'border-white/20 bg-black/40 text-white/60 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
          }`}
        >
          {favorite ? '★' : '☆'}
        </button>

        {assetCount > 1 && (
          <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[11px] text-white/80 backdrop-blur">
            {assetCount} files
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 border-t border-(--color-border) p-3">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full border px-1.5 py-0.5 text-[11px] ${stateTone(generation.state)}`}
          >
            {isInFlight(generation.state) && (
              <span className="mr-1 inline-block animate-pulse" aria-hidden>
                ●
              </span>
            )}
            {stateLabel(generation.state)}
          </span>
          {generation.nsfw && (
            // Only reachable with the NSFW filter on, so this confirms where you
            // are rather than warning you — the grid you are looking at is the
            // marked one.
            <span
              className="rounded-full border border-fuchsia-400/50 bg-fuchsia-400/10 px-1.5 py-0.5 text-[11px] text-fuchsia-300"
              title="Marked private — hidden from Recent and from the unfiltered gallery."
            >
              NSFW
            </span>
          )}
          <span className="ml-auto font-mono text-[11px] text-(--color-ink-muted)">
            {formatTimestamp(generation.createdAt)}
          </span>
        </div>

        {/* Verbatim, and the whole slug — this is what you would paste into the docs. */}
        <code className="truncate font-mono text-[11px] text-(--color-ink-muted)">
          {generation.modelSlug}
        </code>

        {prompt && <p className="line-clamp-2 text-xs leading-snug">{prompt}</p>}

        {generation.failMsg && (
          <p className="line-clamp-3 rounded border-l-2 border-red-400 bg-red-400/10 px-2 py-1 text-[11px] leading-snug text-(--color-ink-muted)">
            {generation.failCode && (
              <code className="mr-1 font-mono text-red-300">{generation.failCode}</code>
            )}
            {generation.failMsg}
          </p>
        )}
      </div>
    </Link>
  )
}

function Preview({ asset }: { asset: CardAsset }) {
  const src = assetHref(asset.localPath, asset.token)

  if (asset.kind === 'video') {
    return (
      // Muted autoplay on hover, per the UX spec. `preload="metadata"` keeps a
      // grid of 48 videos from fetching 48 whole files.
      <video
        src={src}
        muted
        loop
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
        onMouseEnter={(e) => void e.currentTarget.play().catch(() => undefined)}
        onMouseLeave={(e) => {
          e.currentTarget.pause()
          e.currentTarget.currentTime = 0
        }}
      />
    )
  }

  if (asset.kind === 'audio') {
    return (
      <div className="flex h-full w-full items-center justify-center text-3xl text-(--color-ink-muted)">
        ♪
      </div>
    )
  }

  return (
    // A plain <img>: these are local files from our own route, and re-encoding
    // a generation output would misrepresent it.
    <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
  )
}

/** What a tile shows before there are bytes — or when there never will be. */
function Placeholder({ generation }: { generation: CardGeneration }) {
  const running = isInFlight(generation.state)
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
      <span
        className={`text-2xl ${running ? 'animate-pulse text-(--color-accent)' : 'text-(--color-ink-muted)'}`}
        aria-hidden
      >
        {running ? '◐' : generation.state === 'complete' ? '◻' : '⚠'}
      </span>
      <span className="text-[11px] text-(--color-ink-muted)">
        {stateLabel(generation.state)}
      </span>
    </div>
  )
}
