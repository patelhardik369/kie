import Link from 'next/link'

import { ArrowLeft } from './icons.tsx'

/**
 * The masthead every screen opens with.
 *
 * Deliberately small: 22px title, one line of description, actions on the same
 * baseline. The previous version gave this block a 20px eyebrow, a gradient
 * title and 56px of padding — marketing furniture on a working screen. On a
 * tool the header's job is to say where you are and get out of the way, and
 * every pixel it takes is a row of content you cannot see.
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: string
  description?: React.ReactNode
  /** Buttons or links, right-aligned on wide viewports. */
  actions?: React.ReactNode
  /** Chips or small facts under the description. */
  meta?: React.ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pb-5">
      <div className="min-w-0">
        <h1 className="h-page">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-(--color-ink-muted)">
            {description}
          </p>
        )}
        {meta && <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{meta}</div>}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  )
}

/** A back link for the screens that are genuinely a level down. */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1.5 text-[13px] text-(--color-ink-muted) transition-colors duration-(--dur-fast) hover:text-(--color-ink)"
    >
      <ArrowLeft
        size={13}
        className="transition-transform duration-(--dur-fast) group-hover:-translate-x-0.5"
      />
      {children}
    </Link>
  )
}

/**
 * A titled block. `right` carries the section's own action or count, which is
 * what keeps a long page navigable without a second level of headings.
 *
 * The hint belongs to the title, not to the body, so it sits tight under the
 * heading and the whole group is pushed away from the content below it. Giving
 * both gaps the same size — which is what this used to do — leaves the hint
 * stranded between two things it could equally belong to.
 */
export function Section({
  title,
  hint,
  right,
  children,
  className,
}: {
  title: string
  hint?: React.ReactNode
  right?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      <div
        className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 ${
          hint ? 'mb-1' : 'mb-2.5'
        }`}
      >
        <h2 className="text-[13px] font-medium text-(--color-ink)">{title}</h2>
        {right}
      </div>
      {hint && (
        <p className="mb-3.5 max-w-2xl text-xs leading-relaxed text-(--color-ink-muted)">
          {hint}
        </p>
      )}
      {children}
    </section>
  )
}
