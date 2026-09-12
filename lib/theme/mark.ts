/**
 * The Kie Studio mark, bare.
 *
 * The same Aperture that sits in TopNav, with **no ground behind it** — the
 * tab shows the glyph alone on whatever the browser's own chrome is, which is
 * what a favicon is supposed to do. The tradeoff is accepted deliberately: a
 * light tab strip gives the accent less contrast than a dark one, and the
 * alternative (a tile) reads as a boxed logo rather than an icon.
 *
 * It is a separate file from `components/shell/icons.tsx` because it is drawn
 * for a 16px tab, not a 48px nav bar. The 16-unit grid is scaled 2x to fill a
 * 32 box edge to edge, which takes the stroke to 3 units — about 1.5px once
 * the browser resamples to 16 — and keeps the stroke-to-diameter ratio the nav
 * icon was drawn at, so it is the same mark rather than a redrawn one.
 *
 * The geometry lives here exactly ONCE. `app/icon.svg` is the static build of
 * it in the default accent — what browsers, bookmarks and crawlers get with no
 * JavaScript — and `lib/theme/theme.test.ts` fails if that file ever drifts
 * from this string. The accent script rebuilds the same markup at runtime so
 * the tab icon follows the colour chosen in Settings.
 */

/** Replaced with the accent hex wherever it appears in `MARK_SVG`. */
export const MARK_ACCENT_TOKEN = '__ACCENT__'

/** The mark, with `MARK_ACCENT_TOKEN` standing in for the accent hex. */
export const MARK_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">` +
  `<g transform="scale(2)" fill="none" stroke="${MARK_ACCENT_TOKEN}"` +
  ` stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
  `<circle cx="8" cy="8" r="6.3"/>` +
  `<path d="M10.91 8.00L7.30 14.26M9.46 10.52L2.23 10.52M6.55 10.52L2.93 4.26` +
  `M5.09 8.00L8.70 1.74M6.54 5.48L13.77 5.48M9.45 5.48L13.07 11.74"/>` +
  `</g></svg>`

/** The mark painted in one accent hex. */
export function markSvg(hex: string): string {
  return MARK_SVG.split(MARK_ACCENT_TOKEN).join(hex)
}
