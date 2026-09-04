'use client'

import { Star } from '@/components/shell/icons.tsx'
import { usePins } from './pins-store.ts'

/**
 * Pin or unpin one model.
 *
 * Rendered beside a model everywhere one is named — the picker, the catalog, the
 * generate form's header. It carries the model's label and family so the pin bar
 * can render the new pin immediately, before the server has answered.
 *
 * Until the pin list has loaded it renders NEUTRAL rather than empty. An outline
 * star that fills itself in half a second after the page settles reads as the
 * page changing its mind about something you already decided.
 */
export function PinStar({
  slug,
  label,
  family,
  capability,
  size = 14,
  showLabel = false,
}: {
  slug: string
  label?: string
  family?: string | null
  capability?: string | null
  size?: number
  /** Adds the word beside the star, for headers with room for it. */
  showLabel?: boolean
}) {
  const { ready, isPinned, toggle } = usePins()
  const pinned = ready && isPinned(slug)

  return (
    <button
      type="button"
      onClick={(event) => {
        // These sit inside and beside row links; a pin must never navigate.
        event.preventDefault()
        event.stopPropagation()
        toggle({ slug, label, family, capability })
      }}
      disabled={!ready}
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin ${label ?? slug}` : `Pin ${label ?? slug}`}
      title={
        pinned
          ? 'Pinned — it sits at the top of the picker and in the nav.'
          : 'Pin this model to the top of the picker.'
      }
      className={`btn btn-sm shrink-0 ${showLabel ? '' : 'btn-icon'} ${
        pinned ? 'btn-on-warn' : 'btn-quiet'
      } ${ready ? '' : 'pointer-events-none opacity-30'}`}
    >
      <Star size={size} filled={pinned} />
      {showLabel && (pinned ? 'Pinned' : 'Pin')}
    </button>
  )
}
