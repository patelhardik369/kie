'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import {
  STATE_GROUPS,
  galleryHref,
  isFilterActive,
  toDateInput,
  withFilter,
  type GalleryFilter,
  type StateGroup,
} from '@/lib/gallery/filters.ts'
import { CAPABILITIES, FAMILIES } from '@/lib/kie/registry/types.ts'
import type { Capability, Family } from '@/lib/kie/registry/types.ts'

/**
 * The gallery filter bar.
 *
 * Every control writes to the URL and nothing else. That is what makes a
 * filtered view linkable, reloadable, and correct under the back button — and
 * it is why this component holds no filter state of its own beyond the search
 * box, which is debounced so typing does not push one history entry per letter.
 */

const FAMILY_LABEL: Record<Family, string> = {
  kling: 'Kling',
  bytedance: 'ByteDance',
  wan: 'Wan',
}

const CAPABILITY_LABEL: Record<Capability, string> = {
  'text-to-video': 'Text to video',
  'image-to-video': 'Image to video',
  'reference-to-video': 'Reference to video',
  'video-to-video': 'Video to video',
  'speech-to-video': 'Speech to video',
  'motion-control': 'Motion control',
  avatar: 'Avatar',
  'text-to-image': 'Text to image',
  'image-to-image': 'Image to image',
  'layer-decomposition': 'Layer decomposition',
}

const STATE_GROUP_LABEL: Record<StateGroup, string> = {
  complete: 'Complete',
  running: 'Running',
  problem: 'Needs attention',
}

const SEARCH_DEBOUNCE_MS = 300

const controlClass =
  'rounded-md border border-(--color-border) bg-(--color-surface) px-2.5 py-1.5 text-xs ' +
  'outline-none transition focus:border-(--color-accent)'

export function GalleryFilters({
  filter,
  models,
  total,
  shown,
  nsfwCount,
}: {
  filter: GalleryFilter
  /** Model slugs that actually have generations, with counts. */
  models: { value: string; count: number }[]
  total: number
  shown: number
  /** How many generations are marked private, for the chip's label. */
  nsfwCount: number
}) {
  const router = useRouter()
  const [search, setSearch] = useState(filter.search ?? '')

  const go = (patch: Partial<GalleryFilter>) => {
    router.push(galleryHref(withFilter(filter, patch)))
  }

  // Debounced so typing "lemon" pushes one navigation, not five.
  useEffect(() => {
    const current = filter.search ?? ''
    if (search === current) return

    const timer = setTimeout(() => {
      router.push(galleryHref(withFilter(filter, { search: search || undefined })))
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // `filter` is intentionally read fresh on each keystroke; the guard above
    // stops the effect from re-firing on the navigation it caused.
  }, [search, filter, router])

  useEffect(() => {
    setSearch(filter.search ?? '')
  }, [filter.search])

  const active = isFilterActive(filter)

  /**
   * The library you are actually browsing, which is never the whole table.
   * Marked work forms a separate set, so counting it into the denominator of an
   * unfiltered grid would report a total the grid can never reach.
   */
  const browsable = filter.nsfw ? nsfwCount : total - nsfwCount

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search prompts, models, notes…"
          aria-label="Search generations"
          className={`${controlClass} min-w-56 flex-1`}
        />

        <select
          value={filter.family ?? ''}
          onChange={(e) => go({ family: (e.target.value || undefined) as Family })}
          aria-label="Family"
          className={controlClass}
        >
          <option value="">All families</option>
          {FAMILIES.map((family) => (
            <option key={family} value={family}>
              {FAMILY_LABEL[family]}
            </option>
          ))}
        </select>

        <select
          value={filter.capability ?? ''}
          onChange={(e) =>
            go({ capability: (e.target.value || undefined) as Capability })
          }
          aria-label="Capability"
          className={controlClass}
        >
          <option value="">All capabilities</option>
          {CAPABILITIES.map((capability) => (
            <option key={capability} value={capability}>
              {CAPABILITY_LABEL[capability]}
            </option>
          ))}
        </select>

        <select
          value={filter.model ?? ''}
          onChange={(e) => go({ model: e.target.value || undefined })}
          aria-label="Model"
          className={`${controlClass} max-w-56`}
        >
          {/* Only models that have generations — the other 50-odd would be dead options. */}
          <option value="">All models</option>
          {models.map((model) => (
            <option key={model.value} value={model.value}>
              {model.value} ({model.count})
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Chip
          active={!filter.stateGroup && !filter.state}
          onClick={() => go({ stateGroup: undefined, state: undefined })}
        >
          All states
        </Chip>
        {(Object.keys(STATE_GROUPS) as StateGroup[]).map((group) => (
          <Chip
            key={group}
            active={filter.stateGroup === group}
            onClick={() =>
              go({
                stateGroup: filter.stateGroup === group ? undefined : group,
                state: undefined,
              })
            }
          >
            {STATE_GROUP_LABEL[group]}
          </Chip>
        ))}

        <Chip
          active={Boolean(filter.favorite)}
          onClick={() => go({ favorite: filter.favorite ? undefined : true })}
        >
          ★ Favorites
        </Chip>

        {/*
          A switch between two disjoint libraries rather than one more narrowing
          chip: off, the grid never contains marked work; on, it contains nothing
          else. The count sits on the label so the marked set is findable without
          being browsable.
        */}
        {(nsfwCount > 0 || filter.nsfw) && (
          <Chip
            active={Boolean(filter.nsfw)}
            onClick={() => go({ nsfw: filter.nsfw ? undefined : true })}
            title="Generations you marked private. Hidden everywhere else."
          >
            NSFW {nsfwCount > 0 && <span className="opacity-60">{nsfwCount}</span>}
          </Chip>
        )}

        <span className="mx-1 h-4 w-px bg-(--color-border)" aria-hidden />

        <label className="flex items-center gap-1.5 text-xs text-(--color-ink-muted)">
          From
          <input
            type="date"
            value={toDateInput(filter.createdFrom)}
            onChange={(e) =>
              go({
                createdFrom: e.target.value
                  ? new Date(`${e.target.value}T00:00:00`).getTime()
                  : undefined,
              })
            }
            className={controlClass}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-(--color-ink-muted)">
          To
          <input
            type="date"
            value={toDateInput(filter.createdTo)}
            onChange={(e) =>
              go({
                createdTo: e.target.value
                  ? new Date(`${e.target.value}T23:59:59.999`).getTime()
                  : undefined,
              })
            }
            className={controlClass}
          />
        </label>

        <span className="ml-auto font-mono text-xs text-(--color-ink-muted)">
          {active ? `${shown} of ${browsable}` : `${browsable} generations`}
        </span>

        {active && (
          <button
            type="button"
            onClick={() => router.push('/gallery')}
            className="rounded-md border border-(--color-border) px-2.5 py-1.5 text-xs text-(--color-ink-muted) transition hover:border-(--color-ink-muted) hover:text-(--color-ink)"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`rounded-full border px-2.5 py-1 text-xs transition ${
        active
          ? 'border-(--color-accent) bg-(--color-accent)/15 text-(--color-ink)'
          : 'border-(--color-border) text-(--color-ink-muted) hover:border-(--color-ink-muted)'
      }`}
    >
      {children}
    </button>
  )
}
