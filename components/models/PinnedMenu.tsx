'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { Star } from '@/components/shell/icons.tsx'
import { usePins } from './pins-store.ts'

/**
 * The pinned models, reachable from anywhere.
 *
 * The picker's pin bar solves "I do not want to scroll"; this solves "I do not
 * want to navigate". From a gallery page, starting the model you use twenty
 * times a day is one click instead of three.
 *
 * Hidden entirely until something is pinned. A permanent empty dropdown in the
 * nav is a feature advertising itself on a screen you look at all day.
 */
export function PinnedMenu() {
  const { pins, ready } = usePins()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const pathname = usePathname()

  // A navigation is an answer to the menu, so the menu closes.
  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!ready || !pins || pins.length === 0) return null

  return (
    <div className="relative shrink-0" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Pinned models"
        className={`btn btn-sm shrink-0 ${
          open ? 'bg-(--color-surface-hover) text-(--color-ink)' : 'btn-quiet'
        }`}
      >
        <Star size={14} filled className="text-(--color-warn-ink)" />
        <span className="mono">{pins.length}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="pop absolute right-0 z-50 mt-1 max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-(--color-border) bg-(--color-surface-raised) shadow-[var(--shadow-lg)]"
        >
          <p className="eyebrow px-3 pt-2.5 pb-1.5">Pinned</p>
          <ul className="divide-y divide-(--color-border) border-t border-(--color-border)">
            {pins.map((pin) => (
              <li key={pin.slug}>
                {pin.missing ? (
                  <span className="block px-3 py-2 text-xs text-(--color-ink-faint)">
                    {pin.slug}
                    <span className="mt-0.5 block text-(--color-warn-ink)">
                      no longer in the registry
                    </span>
                  </span>
                ) : (
                  <Link
                    href={`/generate/${pin.slug}`}
                    role="menuitem"
                    className="block px-3 py-2 transition-colors duration-(--dur-fast) hover:bg-(--color-accent-softer)"
                  >
                    <span className="block truncate text-[13px]">{pin.label}</span>
                    <code className="mono mt-0.5 block truncate text-(--color-ink-faint)">
                      {pin.slug}
                    </code>
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <Link
            href="/generate"
            className="block border-t border-(--color-border) px-3 py-2 text-xs text-(--color-ink-muted) transition-colors duration-(--dur-fast) hover:text-(--color-ink)"
          >
            All models…
          </Link>
        </div>
      )}
    </div>
  )
}
