'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { PinnedMenu } from '@/components/models/PinnedMenu.tsx'
import { MobileNav } from './MobileNav.tsx'
import { NavPending } from './NavPending.tsx'
import { Aperture, Bookmark, Gear, Grid, Layers, Plus, TextLines } from './icons.tsx'

/**
 * The one persistent piece of chrome.
 *
 * 48px tall and hairline-bordered — a tool's nav is a rail, not a banner. It is
 * static: no scroll listener, no blur that fades in. Chrome that animates while
 * you scroll competes with the content for attention every single time, and the
 * effect is noticed exactly once.
 *
 * **Two layouts, not one that shrinks.** Above `md` the sections sit on the bar
 * as labelled links. Below it they move into a sheet (see MobileNav), because
 * the alternative — which this component used to do — was a horizontally
 * scrolling strip of half-visible words. Most people never discover that a strip
 * like that scrolls, so the app appeared to have two sections and no way to
 * reach the others.
 *
 * What stays on the bar at every width is what earns permanent space: identity,
 * the primary action, and the way in.
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
          {/* The wordmark fits on a phone once the links are behind a button —
              it is the desktop rail that has no room for it, not the phone. */}
          <span className="text-[13px] font-semibold tracking-[-0.02em]">
            Kie Studio
          </span>
        </Link>

        {/* A hairline between identity and navigation. Groups without a rule
            between them read as one undifferentiated strip of links. */}
        <span className="mr-2 hidden h-4 w-px bg-(--color-border) md:block" aria-hidden />

        {/* Pushes the actions right on mobile, where the links are not here. */}
        <span className="flex-1 md:hidden" aria-hidden />

        <nav className="hidden min-w-0 flex-1 items-center gap-0.5 md:flex">
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
                {/* Reports THIS link's pending state — must be a child of it. */}
                <NavPending />
              </Link>
            )
          })}
        </nav>

        {/* The shortlist, reachable from every screen — see PinnedMenu for why
            it renders nothing until something is pinned. Below `md` the same
            pins are listed in the sheet instead, where there is room for names. */}
        <div className="hidden md:contents">
          <PinnedMenu />
        </div>

        <Link
          href="/settings"
          aria-label="Settings"
          aria-current={isActive('/settings') ? 'page' : undefined}
          className={`btn btn-sm btn-icon hidden shrink-0 md:inline-flex ${
            isActive('/settings')
              ? 'bg-(--color-surface-hover) text-(--color-ink)'
              : 'btn-quiet'
          }`}
        >
          <Gear size={15} />
          <NavPending />
        </Link>

        <Link
          href="/generate"
          aria-current={isActive('/generate') ? 'page' : undefined}
          className={`btn btn-primary btn-sm mx-1 shrink-0 ${
            // Being on the page the button leads to is worth showing, but a
            // filled primary cannot go "more filled" — so it recesses instead.
            isActive('/generate') ? 'brightness-90' : ''
          }`}
        >
          <Plus size={13} />
          <span className="hidden sm:inline">New generation</span>
          <span className="sm:hidden">New</span>
        </Link>

        {/* Last, so the thumb reaches it on the edge it is nearest to. */}
        <MobileNav links={LINKS} />
      </div>
    </header>
  )
}
