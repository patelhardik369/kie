/**
 * The icon set.
 *
 * Hand-drawn on a 16px grid at 1.5 stroke, all `currentColor`, all sized by the
 * `size` prop rather than by a wrapper. Unicode glyphs (★ ▶ ✕ ↑ →) were doing
 * this job before: they render in whatever the user's emoji font decides,
 * sit off the baseline, ignore stroke weight and cannot align to text. A
 * consistent stroke across every affordance is one of the few details people
 * read as "made by someone" without being able to name why.
 *
 * No dependency: an icon library would be ~40 files of runtime for the dozen
 * shapes this app actually uses.
 */

interface IconProps {
  /** Pixel box. 14 for inline-with-text, 16 default, 18 for standalone buttons. */
  size?: number
  className?: string
}

function Svg({
  size = 16,
  className,
  children,
  fill,
}: IconProps & { children: React.ReactNode; fill?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={fill ? 'currentColor' : 'none'}
      stroke={fill ? undefined : 'currentColor'}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      // Icons ride next to text constantly; without this they sit a hair high.
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  )
}

/**
 * The brand mark: a camera iris.
 *
 * The first attempt was a circle with three strokes meeting at the centre —
 * which is a Mercedes badge, not an aperture, and not something to ship as an
 * app's mark. The difference is that real iris blades are **chords**, not
 * radii: each one runs past the centre rather than into it, and the six of them
 * leave a hexagonal opening in the middle. Geometry generated for this size, at
 * the same 6.3 outer radius as the gear so the two sit alike in the bar.
 */
export function Aperture({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="8" cy="8" r="6.3" />
      <path d="M10.91 8.00L7.30 14.26M9.46 10.52L2.23 10.52M6.55 10.52L2.93 4.26M5.09 8.00L8.70 1.74M6.54 5.48L13.77 5.48M9.45 5.48L13.07 11.74" />
    </Svg>
  )
}

export function Plus({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </Svg>
  )
}

export function Grid({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="2.25" y="2.25" width="5" height="5" rx="1.25" />
      <rect x="8.75" y="2.25" width="5" height="5" rx="1.25" />
      <rect x="2.25" y="8.75" width="5" height="5" rx="1.25" />
      <rect x="8.75" y="8.75" width="5" height="5" rx="1.25" />
    </Svg>
  )
}

export function Layers({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8 1.75 1.75 5 8 8.25 14.25 5 8 1.75Z" />
      <path d="M1.75 8 8 11.25 14.25 8" />
      <path d="M1.75 11 8 14.25 14.25 11" />
    </Svg>
  )
}

export function Bookmark({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3.75 2.75h8.5v11l-4.25-3-4.25 3v-11Z" />
    </Svg>
  )
}

export function TextLines({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M2.75 3.75h10.5M2.75 7h10.5M2.75 10.25h7M2.75 13.5h4" />
    </Svg>
  )
}

/**
 * The gear, drawn for 16px rather than shrunk to it.
 *
 * The previous version was a 24-grid path scaled down: its teeth ended up about
 * 1.2 units tall against a 1.5-wide stroke, so the lobes filled in and the icon
 * rendered as a rounded blob with a dot. It also reached x≈0.9 and x≈15, which
 * clipped the stroke against the viewBox.
 *
 * This geometry is generated for this size: six teeth (eight are indistinct at
 * 16px), outer radius 6.3 so the stroke's outer edge lands at 7.05 with room to
 * spare, and a 2.15 hole that still reads as a hole once the stroke is on it.
 */
export function Gear({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M6.37 1.91A6.3 6.3 0 0 1 9.63 1.91L9.93 3.66A4.75 4.75 0 0 1 10.79 4.16L12.45 3.55A6.3 6.3 0 0 1 14.09 6.37L12.72 7.5A4.75 4.75 0 0 1 12.72 8.5L14.09 9.63A6.3 6.3 0 0 1 12.45 12.45L10.79 11.84A4.75 4.75 0 0 1 9.93 12.34L9.63 14.09A6.3 6.3 0 0 1 6.37 14.09L6.07 12.34A4.75 4.75 0 0 1 5.21 11.84L3.55 12.45A6.3 6.3 0 0 1 1.91 9.63L3.28 8.5A4.75 4.75 0 0 1 3.28 7.5L1.91 6.37A6.3 6.3 0 0 1 3.55 3.55L5.21 4.16A4.75 4.75 0 0 1 6.07 3.66L6.37 1.91Z" />
      <circle cx="8" cy="8" r="2.15" />
    </Svg>
  )
}

export function Star({ size, className, filled }: IconProps & { filled?: boolean }) {
  return (
    <Svg size={size} className={className} fill={filled}>
      <path
        d="M8 1.9l1.86 3.77 4.16.6-3.01 2.94.71 4.14L8 11.4l-3.72 1.95.71-4.14L1.98 6.27l4.16-.6L8 1.9Z"
        strokeWidth={filled ? 0 : 1.5}
      />
    </Svg>
  )
}

export function ChevronRight({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </Svg>
  )
}

export function ChevronDown({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3.5 6 8 10.5 12.5 6" />
    </Svg>
  )
}

export function ArrowLeft({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M12.75 8H3.25M7 3.75 3.25 8 7 12.25" />
    </Svg>
  )
}

export function ArrowRight({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3.25 8h9.5M9 3.75 12.75 8 9 12.25" />
    </Svg>
  )
}

/** Leaves the app — the diagonal is the convention and people rely on it. */
export function ExternalLink({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M9.75 2.75h3.5v3.5M13.25 2.75 7.5 8.5" />
      <path d="M12 9.75v2.5a1 1 0 0 1-1 1H3.75a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2.5" />
    </Svg>
  )
}

export function Close({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3.75 3.75l8.5 8.5M12.25 3.75l-8.5 8.5" />
    </Svg>
  )
}

/** Three rules on the 16px grid, at the same 1.5 stroke as everything else. */
export function Menu({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M2.75 4.25h10.5M2.75 8h10.5M2.75 11.75h10.5" />
    </Svg>
  )
}

export function ArrowUp({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8 12.75v-9.5M3.75 7.5 8 3.25l4.25 4.25" />
    </Svg>
  )
}

export function ArrowDown({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8 3.25v9.5M3.75 8.5 8 12.75l4.25-4.25" />
    </Svg>
  )
}

export function Search({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="7.25" cy="7.25" r="4.5" />
      <path d="M10.5 10.5l2.75 2.75" />
    </Svg>
  )
}

export function Dice({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.5" />
      <circle cx="5.75" cy="5.75" r=".9" fill="currentColor" stroke="none" />
      <circle cx="10.25" cy="10.25" r=".9" fill="currentColor" stroke="none" />
      <circle cx="10.25" cy="5.75" r=".9" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function Upload({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8 10.75V2.5M4.75 5.75 8 2.5l3.25 3.25" />
      <path d="M2.75 10.5v1.75a1.25 1.25 0 0 0 1.25 1.25h8a1.25 1.25 0 0 0 1.25-1.25V10.5" />
    </Svg>
  )
}

export function Film({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5" />
      <path d="M5 3.25v9.5M11 3.25v9.5M1.75 8h12.5" />
    </Svg>
  )
}

export function Image({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.5" />
      <circle cx="6" cy="6.25" r="1.1" />
      <path d="M2.5 11.25 5.75 8.5l2.5 2.1 2-1.6 3 2.75" />
    </Svg>
  )
}

export function Wave({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M2 8h1.5M5 4.5v7M8 2.75v10.5M11 5.5v5M14 8h-1" />
    </Svg>
  )
}

export function Alert({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.75v3.75M8 11.05v.2" />
    </Svg>
  )
}

/**
 * Information. `Alert` inverted — dot above the stem rather than below, on the
 * same circle, so the two read as a pair rather than as two unrelated marks.
 */
export function Info({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.5v3.75M8 4.75v.2" />
    </Svg>
  )
}

export function Check({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3.25 8.5 6.25 11.5l6.5-7" />
    </Svg>
  )
}

export function Trash({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4 4.25l.6 8.35a.9.9 0 0 0 .9.65h5a.9.9 0 0 0 .9-.65l.6-8.35M6.6 6.75v4M9.4 6.75v4" />
    </Svg>
  )
}

/** Re-run: the same input round again, not a "refresh". */
export function Repeat({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M2.75 8V6.25A2.5 2.5 0 0 1 5.25 3.75h8M11.25 1.75l2 2-2 2" />
      <path d="M13.25 8v1.75a2.5 2.5 0 0 1-2.5 2.5h-8M4.75 10.25l-2 2 2 2" />
    </Svg>
  )
}

/** Tweak: three parameter tracks with the knobs at different stops. */
export function Sliders({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M2.25 4.25h1.85M6.9 4.25h6.85" />
      <path d="M2.25 8h5.35M10.4 8h3.35" />
      <path d="M2.25 11.75h2.85M7.9 11.75h5.85" />
      <circle cx="5.5" cy="4.25" r="1.4" />
      <circle cx="9" cy="8" r="1.4" />
      <circle cx="6.5" cy="11.75" r="1.4" />
    </Svg>
  )
}

/** Private: hidden from the grid, not deleted from it. */
export function EyeOff({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M7.16 3.38a7.16 7.16 0 0 1 7.47 4.39.67.67 0 0 1 0 .46 7.17 7.17 0 0 1-.96 1.66" />
      <path d="M9.39 9.44a2 2 0 0 1-2.83-2.83" />
      <path d="M11.65 11.67a7.17 7.17 0 0 1-10.28-3.44.67.67 0 0 1 0-.46 7.17 7.17 0 0 1 2.96-3.43" />
      <path d="M1.75 1.75l12.5 12.5" />
    </Svg>
  )
}

/* ---------------------------------------------------------------- markup
 *
 * The annotation toolbar. Each one has to read at 14–16px next to its
 * neighbours, so they are drawn as the GESTURE rather than as the tool: a
 * pointer that selects, a nib that draws, a chisel tip that shades. Drawing
 * literal implements at this size produces eight indistinguishable grey blobs.
 */

/** Select and move — the arrow pointer, the one shape everyone already reads. */
export function Cursor({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3.25 2.25l3.6 10.9 1.9-4.35 4.35-1.9z" />
    </Svg>
  )
}

/** Freehand: a pen nib on its stroke. */
export function Pen({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M11.4 1.98a1.75 1.75 0 0 1 2.47 2.47l-7.3 7.3-3.3.83.83-3.3z" />
      <path d="M10.15 3.23l2.47 2.47" />
    </Svg>
  )
}

/** Highlighter: the same stroke with a chisel tip and a laid-down band. */
export function Highlighter({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M9.9 2.35a1.6 1.6 0 0 1 2.26 2.26l-5.1 5.1-2.9.64.64-2.9z" />
      <path d="M2.25 13.4h11.5" />
    </Svg>
  )
}

/** A pointing arrow — the single most effective marker in the set. */
export function ArrowMark({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M2.75 13.25L12.4 3.6" />
      <path d="M7.6 3.25h5v5" />
    </Svg>
  )
}

/** A bare line, for pointing without an arrowhead. */
export function LineMark({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M2.75 13.25L13.25 2.75" />
    </Svg>
  )
}

/** Box a region. */
export function Square({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="1.5" />
    </Svg>
  )
}

/** Circle a subject. */
export function Circle({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="8" cy="8" r="5.25" />
    </Svg>
  )
}

/** A typed label: a serif A, which reads as "text" smaller than a T does. */
export function TypeMark({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3 13.25L8 2.75l5 10.5" />
      <path d="M4.9 9.5h6.2" />
    </Svg>
  )
}

/** A numbered badge — the marker that turns one prompt into a list. */
export function Pin({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M6.9 6.2l1.5-.95v5.5M6.9 10.75h3" />
    </Svg>
  )
}

/** Undo: a step back along the history. */
export function Undo({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M2.75 7.25h7.5a3.25 3.25 0 0 1 0 6.5H6" />
      <path d="M5.25 3.75l-2.5 3.5 2.5 3.5" />
    </Svg>
  )
}

/** Redo: the same step, mirrored. */
export function Redo({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M13.25 7.25h-7.5a3.25 3.25 0 0 0 0 6.5H10" />
      <path d="M10.75 3.75l2.5 3.5-2.5 3.5" />
    </Svg>
  )
}

/*
 * Zoom, for the markup canvas.
 *
 * Built on the same 4.5-radius lens as `Search` rather than a fresh circle, so
 * the three of them read as one family in a bar that already holds nine tools.
 */

export function ZoomIn({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="7.25" cy="7.25" r="4.5" />
      <path d="M7.25 5.25v4M5.25 7.25h4" />
      <path d="M10.5 10.5l2.75 2.75" />
    </Svg>
  )
}

export function ZoomOut({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="7.25" cy="7.25" r="4.5" />
      <path d="M5.25 7.25h4" />
      <path d="M10.5 10.5l2.75 2.75" />
    </Svg>
  )
}

/** Fit: four corners closing in on what is between them. */
export function Fit({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M2.5 5.75v-3.25h3.25M13.5 5.75v-3.25h-3.25M2.5 10.25v3.25h3.25M13.5 10.25v3.25h-3.25" />
    </Svg>
  )
}
