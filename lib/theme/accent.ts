import { MARK_ACCENT_TOKEN, MARK_SVG } from './mark.ts'

/**
 * The accent engine.
 *
 * One colour, chosen in Settings, drives every *interactive* surface: the
 * primary action, focus, selection, links, the running state. It drives
 * **nothing else**. The canvas, panels, borders and text are a fixed
 * near-black scale in app/globals.css and do not move when the accent does —
 * a tool's chrome should read as one dark, stable surface, and tinting the
 * neutrals is what makes an app look sprayed with a colour rather than built
 * around one.
 *
 * The ramp is derived in OKLCH, because that is the only space where holding
 * lightness constant while swapping hue actually looks constant — an HSL ramp
 * makes yellow glare and blue disappear at the same nominal lightness.
 *
 * The maths lives in ONE place: `ACCENT_SCRIPT`, a self-contained IIFE inlined
 * into <head> so the accent is applied before first paint. It publishes
 * `window.__kieAccent`, which the React layer then calls. Duplicating the
 * algorithm in TypeScript would guarantee the two copies drift, so the script
 * is the implementation and TS only types it. The constants it needs — the
 * storage key, the default hex, the mark — are interpolated in from the exports
 * below for the same reason: one definition, no second copy to forget.
 *
 * The tab icon rides along. `app/icon.svg` is the static default that ships in
 * the HTML; once this script has a hex it redraws the same mark in that colour,
 * so the favicon tracks the accent instead of contradicting it.
 */

/** localStorage key holding the chosen hex. */
export const ACCENT_KEY = 'kie-studio.accent'

/**
 * What the studio ships with, what Reset returns to, and what an unreadable
 * stored value falls back to. Kept in step by three other places, all derived
 * rather than retyped: the pre-paint script below, the no-JavaScript ramp in
 * `app/globals.css`, and the static `app/icon.svg`.
 */
export const DEFAULT_ACCENT = '#FFC53D'

/**
 * Starting points, not a restriction — the picker takes any hex.
 * Spaced around the hue circle so the swatch row reads as a spectrum.
 */
export const ACCENT_PRESETS: readonly { hex: string; name: string }[] = [
  { hex: '#4F7FFF', name: 'Studio Blue' },
  { hex: '#6E56CF', name: 'Iris' },
  { hex: '#A555F0', name: 'Amethyst' },
  { hex: '#E93D82', name: 'Magenta' },
  { hex: '#E5484D', name: 'Ember' },
  { hex: '#F76B15', name: 'Tangerine' },
  { hex: '#FFC53D', name: 'Brass' },
  { hex: '#8FD14F', name: 'Chartreuse' },
  { hex: '#12A594', name: 'Jade' },
  { hex: '#00A2C7', name: 'Cyan' },
  { hex: '#8B8D98', name: 'Graphite' },
]

/**
 * The pre-paint bootstrap.
 *
 * Deliberately ES5-flavoured and dependency-free: it runs as a raw inline
 * <script> before React exists, so anything it references must already be in
 * the document.
 */
export const ACCENT_SCRIPT = String.raw`
(function () {
  var KEY = ${JSON.stringify(ACCENT_KEY)};
  var DEFAULT = ${JSON.stringify(DEFAULT_ACCENT)};
  var MARK = ${JSON.stringify(MARK_SVG)};
  var MARK_TOKEN = ${JSON.stringify(MARK_ACCENT_TOKEN)};
  var root = document.documentElement;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /** '#rgb' | '#rrggbb' -> [r, g, b] in 0..1, or null when unparseable. */
  function parseHex(hex) {
    if (typeof hex !== 'string') return null;
    var h = hex.trim().replace(/^#/, '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    var n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  /** sRGB -> OKLCH. Coefficients are Bjorn Ottosson's published matrices. */
  function toOklch(rgb) {
    function lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    var r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]);

    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

    var L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    var A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    var B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;

    var C = Math.sqrt(A * A + B * B);
    var H = (Math.atan2(B, A) * 180) / Math.PI;
    if (H < 0) H += 360;
    return [L, C, H];
  }

  function ok(L, C, H, alpha) {
    var base = clamp(L, 0, 1).toFixed(4) + ' ' + Math.max(0, C).toFixed(4) + ' ' + H.toFixed(2);
    return alpha === undefined ? 'oklch(' + base + ')' : 'oklch(' + base + ' / ' + alpha + ')';
  }

  /**
   * The accent ramp from one hex. Neutrals are NOT derived — see the file
   * header; they are fixed in the stylesheet.
   *
   * Two corrections are applied to whatever was picked:
   *
   *   - **Lightness is pulled into 0.58..0.80.** A near-black or near-white
   *     accent cannot carry a button label or a focus ring on a black shell,
   *     and silently producing an invisible UI is worse than honouring the pick
   *     exactly. Hue and relative saturation survive, so the result still reads
   *     as the colour that was chosen.
   *   - **Chroma is capped at 0.19.** Past that the derived tints clip out of
   *     the display gamut and flatten into one another.
   */
  function build(hex) {
    var rgb = parseHex(hex) || parseHex(DEFAULT);
    var lch = toOklch(rgb);
    var H = lch[2];
    var C = Math.min(lch[1], 0.19);
    var L = clamp(lch[0], 0.58, 0.80);

    return {
      '--accent-h': H.toFixed(2),
      '--accent-c': C.toFixed(4),
      '--accent-l': L.toFixed(4),

      '--color-accent': ok(L, C, H),
      '--color-accent-strong': ok(Math.min(L + 0.07, 0.90), C * 0.96, H),
      '--color-accent-dim': ok(L - 0.14, C * 0.85, H),
      '--color-accent-soft': ok(L, C, H, 0.15),
      '--color-accent-softer': ok(L, C, H, 0.07),
      '--color-accent-line': ok(L, C, H, 0.40),
      '--color-accent-ring': ok(L, C, H, 0.30),
      '--color-accent-glow': ok(L, C, H, 0.35),
      // Text sitting ON an accent fill. Lightness is clamped to >= 0.58 above,
      // so a deep tint of the accent's own hue always wins on contrast.
      '--color-accent-ink': ok(0.16, Math.min(C * 0.30, 0.04), H)
    };
  }

  /**
   * The tab icon, redrawn in the current accent.
   *
   * Next serves app/icon.svg and emits its <link rel="icon"> into the same
   * <head> this script sits in — possibly AFTER it. Writing an href now would
   * just be overwritten when the parser reaches that link, so the swap waits
   * for DOMContentLoaded and then replaces every icon link with one we own.
   * The new link is appended before the old ones are dropped, so the tab never
   * flashes an empty favicon.
   *
   * Everything here is best-effort. If any of it throws, the static
   * app/icon.svg is already installed and correct for the default accent —
   * which is also what bookmarks, history and non-JS clients get.
   */
  var iconHex = null;

  function paintIcon() {
    if (!iconHex) return;
    try {
      var link = document.createElement('link');
      link.setAttribute('rel', 'icon');
      link.setAttribute('type', 'image/svg+xml');
      link.setAttribute('data-kie-icon', '');
      link.setAttribute(
        'href',
        'data:image/svg+xml,' + encodeURIComponent(MARK.split(MARK_TOKEN).join(iconHex))
      );

      var stale = document.querySelectorAll('link[rel~="icon"]');
      (document.head || document.documentElement).appendChild(link);
      for (var i = 0; i < stale.length; i++) {
        if (stale[i].parentNode) stale[i].parentNode.removeChild(stale[i]);
      }
    } catch (e) { /* the served icon stands */ }
  }

  function setIcon(hex) {
    iconHex = parseHex(hex) ? hex : DEFAULT;
    // During head parsing there is nothing to replace yet; the listener below
    // runs once the document's own icon links exist.
    if (document.readyState !== 'loading') paintIcon();
  }

  document.addEventListener('DOMContentLoaded', paintIcon);

  function apply(hex) {
    var vars = build(hex);
    var style = root.style;
    for (var key in vars) if (Object.prototype.hasOwnProperty.call(vars, key)) {
      style.setProperty(key, vars[key]);
    }
    root.setAttribute('data-accent', hex);
    setIcon(hex);
    return vars;
  }

  window.__kieAccent = { KEY: KEY, DEFAULT: DEFAULT, build: build, apply: apply, parse: parseHex };

  var stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
  apply(parseHex(stored) ? stored : DEFAULT);
})();
`

/** What the inline script publishes on `window`. */
export interface AccentApi {
  KEY: string
  DEFAULT: string
  build(hex: string): Record<string, string>
  apply(hex: string): Record<string, string>
  parse(hex: string): [number, number, number] | null
}

declare global {
  interface Window {
    __kieAccent?: AccentApi
  }
}
