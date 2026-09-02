'use client'

import { useEffect, useState } from 'react'

import { Check } from '@/components/shell/icons.tsx'
import { ACCENT_KEY, ACCENT_PRESETS, DEFAULT_ACCENT } from '@/lib/theme/accent.ts'

/**
 * The theme control.
 *
 * Every change is applied to `document.documentElement` immediately and only
 * then written to localStorage — so the app repaints under the new colour as
 * you drag the picker, with no save button and no reload. The inline script in
 * <head> replays that value on the next load.
 *
 * Persistence is best-effort: a browser with storage blocked still themes for
 * the session rather than throwing.
 */
export function AccentPicker() {
  // Server and first client render must agree, so the committed value starts as
  // the default and is corrected from the DOM (already themed by the head
  // script) once mounted.
  const [accent, setAccent] = useState(DEFAULT_ACCENT)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-accent')
    if (current) setAccent(current)
    setMounted(true)
  }, [])

  const commit = (hex: string) => {
    setAccent(hex)
    window.__kieAccent?.apply(hex)
    try {
      localStorage.setItem(ACCENT_KEY, hex)
    } catch {
      // Storage denied — the colour still applies for this session.
    }
  }

  const isDefault = accent.toLowerCase() === DEFAULT_ACCENT.toLowerCase()

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium">Accent</h3>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-(--color-ink-muted)">
            Colours the primary action, focus, selection and the running state.
            The canvas stays black under every choice. Applies instantly and is
            remembered in this browser.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Native picker, styled down to a swatch: it is the only control that
              gives an OS eyedropper and a full gamut for free. */}
          <label
            className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-(--color-border-strong) transition-shadow duration-(--dur-fast) hover:ring-(--color-ink-faint)"
            style={{ background: accent }}
            title="Pick any colour"
          >
            <input
              type="color"
              value={accent}
              onChange={(event) => commit(event.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Accent colour"
            />
          </label>

          <input
            type="text"
            value={accent}
            spellCheck={false}
            onChange={(event) => {
              const next = event.target.value
              setAccent(next)
              // Only a complete, parseable hex repaints — otherwise the app
              // would flicker through garbage while you type over the value.
              if (window.__kieAccent?.parse(next)) commit(next)
            }}
            onBlur={() => {
              if (!window.__kieAccent?.parse(accent)) {
                commit(
                  document.documentElement.getAttribute('data-accent') ?? DEFAULT_ACCENT,
                )
              }
            }}
            className="input w-24 font-mono text-xs uppercase"
            aria-label="Accent colour hex"
          />

          <button
            type="button"
            onClick={() => commit(DEFAULT_ACCENT)}
            disabled={!mounted || isDefault}
            className="btn btn-ghost btn-sm"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {ACCENT_PRESETS.map((preset) => {
          const active = accent.toLowerCase() === preset.hex.toLowerCase()
          return (
            <button
              key={preset.hex}
              type="button"
              onClick={() => commit(preset.hex)}
              title={`${preset.name} · ${preset.hex}`}
              aria-label={preset.name}
              aria-pressed={active}
              // The check confirms selection inside the swatch itself. A ring
              // around it would read as a focus state and collide with the real
              // one two pixels away.
              className="grid h-7 w-7 place-items-center rounded-md ring-1 ring-white/10 transition-transform duration-(--dur-fast) hover:scale-[1.08]"
              style={{ background: preset.hex, color: '#0b0b0d' }}
            >
              {active && <Check size={13} />}
            </button>
          )
        })}
      </div>

      {/* A live sample of the derived tokens, so the pick can be judged against
          the components it will actually colour rather than against a swatch. */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-(--color-border) pt-4">
        <span className="btn btn-primary btn-sm pointer-events-none">Generate</span>
        <span className="btn btn-ghost btn-sm pointer-events-none">Secondary</span>
        <span className="chip chip-accent">generating</span>
        <span className="chip chip-ok">complete</span>
        <span className="chip chip-warn">stalled</span>
        <span className="chip chip-bad">failed</span>
        <span className="bar-indeterminate ml-1 h-1 w-16 rounded-full" aria-hidden />
      </div>
    </div>
  )
}
