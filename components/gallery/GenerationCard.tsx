'use client'

import Link from 'next/link'
import { useState } from 'react'

import { Alert, Film, Image as ImageIcon, Star, Wave } from '@/components/shell/icons.tsx'
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
  const running = isInFlight(generation.state)

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
    <Link href={`/gallery/${generation.id}`} className="tile group relative flex flex-col">
      <div className="relative aspect-square w-full overflow-hidden bg-(--color-bg-deep)">
        {thumbnail ? (
          <Preview asset={thumbnail} />
        ) : (
          <Placeholder generation={generation} />
        )}

        {/* A scrim under the overlay controls only. Dimming the whole thumbnail
            to make one 13px star legible would be a bad trade. */}
        <span
          className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-linear-to-b from-black/50 to-transparent opacity-0 transition-opacity duration-(--dur) group-hover:opacity-100"
          aria-hidden
        />

        <button
          type="button"
          onClick={toggleFavorite}
          disabled={saving}
          aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={favorite}
          className={`absolute top-1.5 right-1.5 grid h-6 w-6 place-items-center rounded-md backdrop-blur-md transition duration-(--dur-fast) ${
            favorite
              ? 'bg-black/50 text-(--color-warn-ink)'
              : 'bg-black/45 text-white/75 opacity-0 group-hover:opacity-100 hover:text-white focus-visible:opacity-100'
          }`}
        >
          <Star size={13} filled={favorite} />
        </button>

        {assetCount > 1 && (
          <span className="absolute right-1.5 bottom-1.5 rounded bg-black/65 px-1.5 py-0.5 font-mono text-[10px] text-white/85 backdrop-blur-md">
            {assetCount}
          </span>
        )}

        {/* Work in flight, readable from across the room. */}
        {running && (
          <span className="bar-indeterminate absolute inset-x-0 bottom-0 h-0.5" aria-hidden />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 border-t border-(--color-border) p-2.5">
        <div className="flex items-center gap-1.5">
          <span className={stateTone(generation.state)}>{stateLabel(generation.state)}</span>
          {generation.nsfw && (
            // Only reachable with the NSFW filter on, so this confirms where you
            // are rather than warning you — the grid you are looking at is the
            // marked one.
            <span
              className="chip chip-private"
              title="Marked private — hidden from Recent and from the unfiltered gallery."
            >
              NSFW
            </span>
          )}
          <span className="mono ml-auto shrink-0 text-[10px] text-(--color-ink-faint)">
            {formatTimestamp(generation.createdAt)}
          </span>
        </div>

        {/* Verbatim, and the whole slug — this is what you would paste into the docs. */}
        <code className="mono truncate text-[10px] text-(--color-ink-faint)">
          {generation.modelSlug}
        </code>

        {prompt && (
          <p className="line-clamp-2 text-xs leading-snug text-(--color-ink-muted)">{prompt}</p>
        )}

        {generation.failMsg && (
          <p className="note note-bad line-clamp-3 px-2 py-1 text-[11px] leading-snug">
            {generation.failCode && (
              <code className="mr-1 font-mono font-medium">{generation.failCode}</code>
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
      <div className="flex h-full w-full items-center justify-center text-(--color-ink-faint)">
        <Wave size={28} />
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
  const failed = !running && generation.state !== 'complete'

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
      <span
        className={
          failed
            ? 'text-(--color-bad-ink)'
            : running
              ? 'text-(--color-accent)'
              : 'text-(--color-ink-faint)'
        }
      >
        {failed ? (
          <Alert size={20} />
        ) : generation.family === 'bytedance' ? (
          <ImageIcon size={20} />
        ) : (
          <Film size={20} />
        )}
      </span>
      <span className="text-[11px] text-(--color-ink-faint)">
        {stateLabel(generation.state)}
      </span>
    </div>
  )
}
