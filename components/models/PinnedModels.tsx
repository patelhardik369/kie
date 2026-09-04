'use client'

import Link from 'next/link'

import { ArrowDown, ArrowUp, ChevronRight, Close, Star } from '@/components/shell/icons.tsx'
import type { PinnedModel } from '@/lib/models/favorites.ts'
import { hydratePins, usePins } from './pins-store.ts'

/**
 * The pinned shortlist.
 *
 * The whole point of the feature: the four or five models actually in use, above
 * the 82 that are merely available. It is the first thing on the picker and the
 * first thing in the home sidebar, so the common case — "the model I used
 * yesterday" — is a click rather than a scroll.
 *
 * Order is manual, by arrows rather than drag: this list is five rows on a
 * single-user local tool, and a drag implementation is a pointer-events surface
 * with touch, keyboard and accessibility obligations that two buttons do not
 * have.
 */

/**
 * Seeds the client store from the server render.
 *
 * Rendered by pages that already read the pins on the server, so the bar and its
 * stars paint correct on the FIRST frame instead of appearing a moment later and
 * pushing the page down.
 */
export function PinsHydrator({ pins }: { pins: PinnedModel[] }) {
  hydratePins(pins)
  return null
}

export function PinnedModels({
  variant = 'full',
  heading,
}: {
  variant?: 'full' | 'compact'
  /**
   * Rendered by this component rather than by the page around it.
   *
   * The compact list disappears when the last pin is removed, and a heading
   * owned by a server component would sit there afterwards labelling nothing
   * until the next reload.
   */
  heading?: string
}) {
  const { pins, ready, error, toggle, reorder } = usePins()

  const wrap = (children: React.ReactNode) =>
    heading ? (
      <section>
        <h2 className="mb-2.5 text-[13px] font-medium text-(--color-ink)">{heading}</h2>
        {children}
      </section>
    ) : (
      children
    )

  // Nothing at all until the list is known — a bar that flashes empty and then
  // fills is worse than one that arrives whole.
  if (!ready || !pins) return null

  if (pins.length === 0) {
    return variant === 'compact' ? null : (
      <p className="rounded-xl border border-dashed border-(--color-border) px-4 py-3 text-xs text-(--color-ink-muted)">
        Nothing pinned yet. Press the{' '}
        <Star size={11} className="inline-block align-[-1px] text-(--color-warn-ink)" /> beside any
        model below to keep it up here, on the home page, and in the nav.
      </p>
    )
  }

  if (variant === 'compact') {
    return wrap(
      <ul className="panel-flush divide-y divide-(--color-border)">
        {pins.map((pin) => (
          <li key={pin.slug}>
            <Link
              href={`/generate/${pin.slug}`}
              className="row group flex items-center gap-2.5 px-3 py-2.5"
            >
              <Star size={12} className="shrink-0 text-(--color-warn-ink)" filled />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{pin.label}</span>
                {pin.missing && (
                  <span className="mt-0.5 block text-[11px] text-(--color-warn-ink)">
                    not in the registry
                  </span>
                )}
              </span>
              <ChevronRight
                size={13}
                className="shrink-0 text-(--color-ink-faint) transition-transform duration-(--dur-fast) group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>,
    )
  }

  return wrap(
    <div className="space-y-2">
      {error && <p className="note note-bad">{error}</p>}

      <ul className="panel-flush divide-y divide-(--color-border)">
        {pins.map((pin, index) => (
          <li key={pin.slug} className="flex items-center gap-1 pr-2">
            {/* A pin whose model has left the registry has nowhere to link to —
                it renders as plain text so the only thing you can do with it is
                the thing that helps: unpin it. */}
            {pin.missing ? (
              <span className="min-w-0 flex-1 px-3.5 py-2.5">
                <span className="block truncate text-[13px] font-medium text-(--color-ink-muted)">
                  {pin.slug}
                </span>
                <span className="mono mt-0.5 block text-(--color-warn-ink)">
                  no longer in the registry
                </span>
              </span>
            ) : (
              <Link
                href={`/generate/${pin.slug}`}
                className="row group flex min-w-0 flex-1 items-center justify-between gap-4 px-3.5 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{pin.label}</span>
                  <code className="mono mt-0.5 block truncate text-(--color-ink-faint)">
                    {pin.slug}
                  </code>
                </span>
                <ChevronRight
                  size={13}
                  className="shrink-0 text-(--color-ink-faint) transition-transform duration-(--dur-fast) group-hover:translate-x-0.5"
                />
              </Link>
            )}

            <span className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => reorder(pin.slug, -1)}
                disabled={index === 0}
                className="btn btn-quiet btn-sm btn-icon"
                aria-label={`Move ${pin.label} up`}
              >
                <ArrowUp size={12} />
              </button>
              <button
                type="button"
                onClick={() => reorder(pin.slug, 1)}
                disabled={index === pins.length - 1}
                className="btn btn-quiet btn-sm btn-icon"
                aria-label={`Move ${pin.label} down`}
              >
                <ArrowDown size={12} />
              </button>
              <button
                type="button"
                onClick={() => toggle({ slug: pin.slug })}
                className="btn btn-quiet btn-danger btn-sm btn-icon"
                aria-label={`Unpin ${pin.label}`}
                title="Unpin"
              >
                <Close size={12} />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>,
  )
}
