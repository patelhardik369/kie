'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { PinnedMenu } from '@/components/models/PinnedMenu.tsx'
import { Aperture, Bookmark, Gear, Grid, Layers, Plus, TextLines } from './icons.tsx'

/**
 * The one persistent piece of chrome.
 *
 * 48px tall and hairline-bordered — a tool's nav is a rail, not a banner. It is
 * static: no scroll listener, no blur that fades in. Chrome that animates while
 * you scroll competes with the content for attention every single time, and the
 * effect is noticed exactly once.
 *
 * A client component only because the active section is derived from the
 * current path; there is no data fetching here.
 */

/**
 * Places you browse. `/generate` is deliberately absent: it is an action, not a
 * section, and the primary button on the right already owns that route — a
 * "Generate" link sitting 60px from a "New generation" button pointing at the
 * same page is the kind of duplication that makes a nav feel unconsidered.
 */
const LINKS = [
  { href: '/gallery', label: 'Gallery', Icon: Grid },
  { href: '/models', label: 'Models', Icon: Layers },
  { href: '/presets', label: 'Presets', Icon: Bookmark },
  { href: '/prompts', label: 'Prompts', Icon: TextLines },
] as const

export function TopNav() {
  const pathname = usePathname() ?? '/'
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`)

  return (
    <header className="sticky top-0 z-40 h-12 border-b border-(--color-border) bg-(--color-bg)/85 backdrop-blur-xl">
      <div className="mx-auto flex h-full max-w-[1400px] items-center gap-1 px-4">
        <Link
          href="/"
          className="mr-2 flex shrink-0 items-center gap-2 rounded-md px-1 py-1 text-(--color-ink)"
          aria-label="Kie Studio home"
        >
          <Aperture size={17} className="text-(--color-accent)" />
          <span className="hidden text-[13px] font-semibold tracking-[-0.02em] sm:block">
            Kie Studio
          </span>
        </Link>

        {/* A hairline between identity and navigation. Groups without a rule
            between them read as one undifferentiated strip of links. */}
        <span className="mr-2 hidden h-4 w-px bg-(--color-border) sm:block" aria-hidden />

        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {LINKS.map(({ href, label, Icon }) => {
            const active = isActive(href)
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] transition-colors duration-(--dur-fast) ${
                  active
                    ? 'bg-(--color-surface-hover) text-(--color-ink)'
                    : 'text-(--color-ink-muted) hover:bg-(--color-surface-raised) hover:text-(--color-ink)'
                }`}
              >
                <Icon
                  size={14}
                  className={active ? 'text-(--color-accent)' : undefined}
                />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* The shortlist, reachable from every screen — see PinnedMenu for why
            it renders nothing until something is pinned. */}
        <PinnedMenu />

        <Link
          href="/settings"
          aria-label="Settings"
          aria-current={isActive('/settings') ? 'page' : undefined}
          className={`btn btn-sm btn-icon shrink-0 ${
            isActive('/settings')
              ? 'bg-(--color-surface-hover) text-(--color-ink)'
              : 'btn-quiet'
          }`}
        >
          <Gear size={15} />
        </Link>

        <Link
          href="/generate"
          aria-current={isActive('/generate') ? 'page' : undefined}
          className={`btn btn-primary btn-sm ml-1 shrink-0 ${
            // Being on the page the button leads to is worth showing, but a
            // filled primary cannot go "more filled" — so it recesses instead.
            isActive('/generate') ? 'brightness-90' : ''
          }`}
        >
          <Plus size={13} />
          <span className="hidden sm:inline">New generation</span>
          <span className="sm:hidden">New</span>
        </Link>
      </div>
    </header>
  )
}
