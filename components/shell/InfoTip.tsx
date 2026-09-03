import { Info } from './icons.tsx'

/**
 * A hover/focus disclosure for text that is worth keeping but not worth reading
 * every time.
 *
 * Model `notes` are the case this exists for. They are transcription records —
 * doc conflicts, confirmed-against-the-live-API findings, "this field is a
 * string here and an integer there" — written for whoever is debugging a 422,
 * not for someone who opened the page to generate an image. Printed inline they
 * pushed a paragraph of prose above every form; the information still has to be
 * one gesture away, so it moves behind an "i" rather than being deleted.
 *
 * ## No JavaScript
 *
 * Pure CSS `peer-hover` / `peer-focus`, so the pages that use it stay server
 * components and the tooltip costs nothing at runtime. `peer-focus` rather than
 * `peer-focus-visible` on purpose: a tap gives focus but usually does not count
 * as focus-visible, and a tooltip that only opens on hover is a tooltip that
 * does not exist on a touchscreen.
 *
 * ## Why it is a fragment, and why the parent must be `relative`
 *
 * The panel is positioned against the whole row rather than against the icon,
 * spanning it edge to edge. Anchoring to the icon is the obvious thing and it
 * breaks: the icon sits at the end of a wrapping row of chips, so on a narrow
 * screen it can land anywhere along that line, and a fixed-width panel hung off
 * `left-0` then runs off the side of the viewport. There is no CSS-only way to
 * detect that and flip it. Anchoring to the row makes the position independent
 * of where the chips happened to wrap, which is both safe and more predictable
 * to read — and it gives long notes the full content width.
 *
 * The trade is that the trigger and the panel must be siblings inside a
 * positioned row, so this returns a fragment and the caller adds `relative`.
 */
export function InfoTip({
  id,
  label = 'notes',
  children,
}: {
  /** Unique on the page; links the trigger to the panel for screen readers. */
  id: string
  label?: string
  children: React.ReactNode
}) {
  return (
    <>
      <button
        type="button"
        aria-describedby={id}
        // `cursor-help` rather than `pointer`: it opens nothing and goes
        // nowhere, and the cursor should not promise that it does.
        className="peer chip cursor-help transition-colors duration-(--dur-fast) hover:border-(--color-accent-line) hover:text-(--color-accent) focus-visible:border-(--color-accent-line) focus-visible:text-(--color-accent)"
      >
        <Info size={11} />
        {label}
      </button>

      <span
        id={id}
        role="tooltip"
        /*
         * Hidden with opacity, NOT `visibility` or `hidden`. Both of those drop
         * the element from the accessibility tree, which would leave the
         * `aria-describedby` above pointing at nothing. `pointer-events-none`
         * does the part `visibility` was wanted for — keeping an invisible panel
         * from swallowing clicks on whatever is beneath it.
         */
        className="pointer-events-none absolute top-full left-0 z-30 mt-1.5 w-full max-w-[42rem] rounded-lg border border-(--color-border) bg-(--color-surface-raised) px-3 py-2.5 text-[12px] leading-relaxed text-wrap text-(--color-ink-muted) opacity-0 shadow-[var(--shadow-lg)] transition-opacity duration-(--dur-fast) peer-hover:opacity-100 peer-focus:opacity-100"
      >
        {children}
      </span>
    </>
  )
}
