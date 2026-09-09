'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Alert, Film, Image as ImageIcon, Star, Trash, Wave } from '@/components/shell/icons.tsx'
import {
  assetHref,
  formatTimestamp,
  isInFlight,
  promptOf,
  stateLabel,
  stateTone,
} from '@/lib/gallery/display.ts'
import { getModel } from '@/lib/kie/registry/index.ts'

/**
 * One tile in the gallery grid.
 *
 * A failed generation gets a card showing its `failCode` and `failMsg`, not a
 * gap in the grid (docs/UX-SPEC.md). A failure you can read is worth more than
 * a clean grid — it is usually a moderation message, and it is the only clue to
 * what tripped it.
 *
 * The tile carries a delete, because "that one is bad" is a judgement you make
 * while scrolling the grid, not one worth opening a page for. It arms on the
 * first click and commits on the second, and disarms the moment the pointer
 * leaves — a one-click destructive control inside a link you click to navigate
 * would eventually delete something by accident.
 */

export interface CardAsset {
  kind: 'image' | 'video' | 'audio'
  storagePath: string
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
  const router = useRouter()
  const [favorite, setFavorite] = useState(generation.favorite)
  const [saving, setSaving] = useState(false)
  const [armed, setArmed] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [removed, setRemoved] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  const remove = async (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()

    if (!armed) {
      setArmed(true)
      return
    }

    setDeleting(true)
    setError(null)
    try {
      const response = await fetch(`/api/generations/${generation.id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data?.error ?? 'Could not delete this generation.')
      }
      // Gone from the grid at once, then a refresh so the counts, the facets and
      // the page boundaries agree with what is left.
      setRemoved(true)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setDeleting(false)
      setArmed(false)
    }
  }

  if (removed) return null

  return (
    <Link
      href={`/gallery/${generation.id}`}
      onMouseLeave={() => setArmed(false)}
      // The date is off the face of the tile — a grid is scanned by picture and
      // by prompt, and 48 timestamps are 48 pieces of noise nobody reads. It is
      // still one hover away here, and printed in full on the detail page.
      title={formatTimestamp(generation.createdAt)}
      className="tile group relative flex flex-col"
    >
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

        {/* Left corner, opposite the star: the two destructive-adjacent clicks
            never share a hit area. Hidden while the runner still owns the row —
            the API refuses it, and an enabled control that cannot work lies. */}
        {!running && (
          <button
            type="button"
            onClick={remove}
            disabled={deleting}
            aria-label={armed ? 'Confirm delete' : 'Delete this generation'}
            title={
              armed
                ? 'Click again to delete this generation and its files. No undo.'
                : 'Delete this generation'
            }
            className={`absolute top-1.5 left-1.5 flex h-6 items-center justify-center gap-1 rounded-md backdrop-blur-md transition duration-(--dur-fast) ${
              armed
                ? 'bg-(--color-bad) px-2 text-[10px] font-medium text-white'
                : 'w-6 bg-black/45 text-white/75 opacity-0 group-hover:opacity-100 hover:text-white focus-visible:opacity-100'
            }`}
          >
            <Trash size={13} />
            {armed && <span>{deleting ? 'Deleting…' : 'Sure?'}</span>}
          </button>
        )}

        {error && (
          <span className="absolute inset-x-1.5 bottom-1.5 rounded bg-(--color-bad) px-1.5 py-1 text-[10px] leading-snug text-white">
            {error}
          </span>
        )}

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
          <span className={`${stateTone(generation.state)} shrink-0`}>
            {stateLabel(generation.state)}
          </span>
          {generation.nsfw && (
            // Only reachable with the NSFW filter on, so this confirms where you
            // are rather than warning you — the grid you are looking at is the
            // marked one.
            <span
              className="chip chip-private shrink-0"
              title="Marked private — hidden from Recent and from the unfiltered gallery."
            >
              NSFW
            </span>
          )}
          {/* Verbatim, and the whole slug — this is what you would paste into
              the docs. It takes the rest of the row now that the timestamp is
              gone, so a long slug truncates far later than it used to. */}
          <code
            className="mono ml-auto min-w-0 truncate text-[10px] text-(--color-ink-faint)"
            title={generation.modelSlug}
          >
            {generation.modelSlug}
          </code>
        </div>

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
  const src = assetHref(asset.storagePath, asset.token)

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

/**
 * The icon standing in for a generation whose bytes are not on disk yet.
 *
 * Falls back to the film reel for a slug the registry no longer knows: an old
 * row from a retired model still deserves a tile, and video is the majority.
 */
function OutputIcon({ slug }: { slug: string }) {
  switch (getModel(slug)?.outputKind) {
    case 'image':
      return <ImageIcon size={20} />
    case 'audio':
      return <Wave size={20} />
    default:
      return <Film size={20} />
  }
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
        {/*
          Keyed off the model's declared outputKind, not its family. Family was a
          usable proxy while ByteDance was the only one shipping image models;
          Google, OpenAI and Enhance all mix output kinds, so the proxy would now
          show a film reel over a still image.
        */}
        {failed ? <Alert size={20} /> : <OutputIcon slug={generation.modelSlug} />}
      </span>
      <span className="text-[11px] text-(--color-ink-faint)">
        {stateLabel(generation.state)}
      </span>
    </div>
  )
}
