import { ACCENT_SCRIPT } from '@/lib/theme/accent.ts'

/**
 * Applies the saved accent before first paint.
 *
 * It has to be a raw inline script rather than an effect: a `useEffect` runs
 * after the first paint, so the page would flash the default blue on every
 * navigation-less load. `beforeInteractive` from next/script is not enough
 * either — this must execute in document order, ahead of the body.
 */
export function AccentScript() {
  return <script dangerouslySetInnerHTML={{ __html: ACCENT_SCRIPT }} />
}
