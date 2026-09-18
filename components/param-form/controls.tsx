'use client'

import { useRef, useState } from 'react'

import { MarkupButton } from '@/components/annotate/MarkupButton.tsx'
import { Close, Dice, Plus, Upload } from '@/components/shell/icons.tsx'
import { errorMessage } from '@/lib/client/api.ts'
import { uploadInput } from '@/lib/client/upload.ts'
import type { ParamDef } from '@/lib/kie/registry/types.ts'
import { AssetPicker } from './AssetPicker.tsx'

/**
 * Leaf controls, one per ParamType.
 *
 * Nothing here knows about a model. Every control is chosen by `param.type` and
 * configured by the ParamDef, which is what lets 86 models share one form.
 */

export interface ControlProps<T = unknown> {
  param: ParamDef
  value: T
  onChange: (value: unknown) => void
  disabled?: boolean
  /** Overrides param.max when a constraint lowers it. */
  max?: number
  /**
   * Overrides param.enum when a constraint narrows it.
   *
   * Arrives already intersected and already in the parameter's own enum order,
   * so the control renders it as-is and the options never reshuffle mid-edit.
   */
  options?: Array<string | number>
  /**
   * Required in the CURRENT state. A constraint can make an optional field
   * required (or vice versa), so controls must not read param.required directly.
   */
  required?: boolean
  /**
   * The images this control annotates, for a param that declares `drawsOn`.
   *
   * The only sibling value any control sees, and it arrives because the ParamDef
   * asked for it by key — not because the component knows which model it is
   * rendering. Extending the schema is what keeps this generic.
   */
  sourceUrls?: string[]
  /**
   * Present when an image in this field can be marked up.
   *
   * Its presence IS the gate — `lib/annotate/targets.ts` decides from registry
   * data whether the field takes an image and whether the model has a prompt to
   * name the marks in, and the form passes this only when both hold. A control
   * therefore never tests a slug, a family or a capability to know whether to
   * offer the editor.
   */
  annotate?: {
    /** Appends legend text to the model's prompt field. */
    onLegend: (text: string) => void
  }
}

/** The effective requiredness, honouring constraint-derived overrides. */
function isRequired(props: ControlProps): boolean {
  return props.required ?? Boolean(props.param.required)
}

/**
 * Every field in the form is the same field.
 *
 * The recipe itself lives in app/globals.css as `.input`, so a control here can
 * still bolt utilities on top (`w-28`, `font-mono`) without restating the
 * border, focus ring and disabled treatment eleven times.
 */
const inputBase = 'input'

export function TextControl(props: ControlProps) {
  const { param, value, onChange, disabled } = props
  const text = typeof value === 'string' ? value : ''
  return (
    <div>
      <textarea
        className={`${inputBase} min-h-24 resize-y font-sans leading-relaxed`}
        value={text}
        disabled={disabled}
        placeholder={isRequired(props) ? 'Required' : 'Optional'}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="mt-1 flex items-center gap-3">
        {/* The prompt library, reachable from every text field rather than only
            the one named `prompt` — negative prompts are worth saving too. */}
        <PromptPicker
          disabled={disabled}
          onInsert={(body) => onChange(text ? `${text.trimEnd()} ${body}` : body)}
          onSave={text}
        />
        {param.maxLength !== undefined && (
          <span
            className={`ml-auto font-mono text-xs ${
              text.length > param.maxLength
                ? 'text-(--color-bad)'
                : 'text-(--color-ink-muted)'
            }`}
          >
            {text.length} / {param.maxLength}
          </span>
        )}
      </div>
    </div>
  )
}

interface SavedPrompt {
  id: string
  title: string
  body: string
  tagsJson: string
}

/**
 * Insert a saved prompt into a text field, or save the current text.
 *
 * Loaded lazily on first open: a form with four text fields should not fetch
 * the prompt library four times before you have asked for it.
 */
function PromptPicker({
  disabled,
  onInsert,
  onSave,
}: {
  disabled?: boolean
  onInsert: (body: string) => void
  onSave: string
}) {
  const [open, setOpen] = useState(false)
  const [prompts, setPrompts] = useState<SavedPrompt[] | null>(null)
  const [saved, setSaved] = useState(false)

  const load = async () => {
    setOpen((wasOpen) => !wasOpen)
    if (prompts) return
    try {
      const response = await fetch('/api/prompts', { cache: 'no-store' })
      const data = await response.json()
      setPrompts(data.prompts ?? [])
    } catch {
      setPrompts([])
    }
  }

  const save = async () => {
    if (!onSave.trim()) return
    await fetch('/api/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: onSave, tags: [] }),
    })
    setSaved(true)
    setPrompts(null)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={load}
          className="text-[11px] text-(--color-ink-muted) underline underline-offset-2 transition-colors duration-(--dur-fast) hover:text-(--color-accent) disabled:opacity-40"
        >
          Prompts
        </button>
        {onSave.trim() && (
          <button
            type="button"
            disabled={disabled}
            onClick={save}
            className="text-[11px] text-(--color-ink-muted) underline underline-offset-2 transition-colors duration-(--dur-fast) hover:text-(--color-accent) disabled:opacity-40"
          >
            {saved ? 'Saved' : 'Save this'}
          </button>
        )}
      </div>

      {open && (
        <div className="pop absolute z-20 mt-1 max-h-64 w-96 overflow-y-auto rounded-lg border border-(--color-border) bg-(--color-surface-raised) shadow-[var(--shadow-lg)]">
          {prompts === null ? (
            <p className="px-3 py-2 text-xs text-(--color-ink-muted)">Loading…</p>
          ) : prompts.length === 0 ? (
            <p className="px-3 py-2 text-xs text-(--color-ink-muted)">
              No saved prompts yet.
            </p>
          ) : (
            <ul className="divide-y divide-(--color-border)">
              {prompts.map((prompt) => (
                <li key={prompt.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onInsert(prompt.body)
                      setOpen(false)
                    }}
                    className="block w-full px-3 py-2 text-left transition hover:bg-(--color-accent-softer)"
                  >
                    <span className="block text-xs font-medium">{prompt.title}</span>
                    <span className="mt-0.5 block line-clamp-2 text-[11px] text-(--color-ink-muted)">
                      {prompt.body}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export function StringControl(props: ControlProps) {
  const { value, onChange, disabled } = props
  return (
    <input
      className={inputBase}
      value={typeof value === 'string' ? value : ''}
      disabled={disabled}
      placeholder={isRequired(props) ? 'Required' : 'Optional'}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function EnumControl(props: ControlProps) {
  const { param, value, onChange, disabled } = props
  const required = isRequired(props)
  const allowed = props.options ?? param.enum ?? []
  /*
   * A value the user picked BEFORE a constraint narrowed the list stays on
   * screen, selected, even though it is no longer allowed. Dropping it would
   * leave the control looking empty while the payload still carries the old
   * value — the validator flags it, and you cannot fix what you cannot see.
   */
  const stale =
    value !== undefined && value !== '' && !allowed.includes(value as string | number)
  const options = stale ? [...allowed, value as string | number] : allowed

  // Segmented control reads faster at small option counts; select scales better.
  if (options.length <= 4) {
    return (
      <div className="flex flex-wrap gap-1">
        {options.map((option) => {
          const selected = value === option
          return (
            <button
              key={String(option)}
              type="button"
              disabled={disabled}
              onClick={() => onChange(selected && !required ? undefined : option)}
              className={`btn btn-sm font-mono text-xs ${
                selected
                  ? 'border-(--color-accent-line) bg-(--color-accent-soft) text-(--color-accent)'
                  : 'btn-ghost text-(--color-ink-muted)'
              }`}
            >
              {String(option)}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <select
      className={`select-field ${inputBase} font-mono`}
      value={value === undefined ? '' : String(value)}
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value
        if (raw === '') return onChange(undefined)
        const match = options.find((o) => String(o) === raw)
        onChange(match)
      }}
    >
      {!required && <option value="">— not set —</option>}
      {options.map((option) => (
        <option key={String(option)} value={String(option)}>
          {String(option)}
        </option>
      ))}
    </select>
  )
}

export function NumberControl(props: ControlProps) {
  const { param, value, onChange, disabled, max } = props
  const upper = max ?? param.max
  const num = typeof value === 'number' ? value : undefined
  const showSlider = param.min !== undefined && upper !== undefined

  return (
    <div className="flex items-center gap-3">
      {showSlider && (
        <input
          type="range"
          className="flex-1 disabled:opacity-40"
          min={param.min}
          max={upper}
          step={param.step ?? 1}
          value={num ?? param.min ?? 0}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      )}
      <input
        type="number"
        // Narrower beside a slider on a phone: 112px of number input plus a
        // range track does not fit inside 360px minus the page gutters.
        className={`${inputBase} ${showSlider ? 'w-20 sm:w-28' : ''} font-mono`}
        min={param.min}
        max={upper}
        step={param.step ?? 1}
        value={num ?? ''}
        disabled={disabled}
        placeholder={isRequired(props) ? 'Required' : '—'}
        onChange={(e) => {
          const raw = e.target.value
          onChange(raw === '' ? undefined : Number(raw))
        }}
      />
    </div>
  )
}

export function BooleanControl({ value, onChange, disabled }: ControlProps) {
  const on = value === true
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-(--dur-fast) disabled:cursor-not-allowed disabled:opacity-40 ${
        on
          ? 'border-(--color-accent) bg-(--color-accent)'
          : 'border-(--color-border-strong) bg-(--color-surface) hover:border-(--color-ink-faint)'
      }`}
    >
      {/*
        The knob travels on `transform`, not `left`. Animating `left` relayouts
        the button on every frame of a 140ms tween — invisible on this machine,
        visibly janky on a mid-tier laptop with a long form open.
      */}
      <span
        className={`absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full shadow-[0_1px_2px_rgb(0_0_0/0.4)] transition-transform duration-(--dur-fast) ease-(--ease) ${
          on
            ? 'translate-x-4 bg-(--color-accent-ink)'
            : 'translate-x-0 bg-(--color-ink-faint)'
        }`}
      />
    </button>
  )
}

export function SeedControl({ param, value, onChange, disabled }: ControlProps) {
  const min = param.min ?? 0
  const max = param.max ?? 2147483647
  return (
    <div className="flex gap-2">
      <input
        type="number"
        className={`${inputBase} font-mono`}
        min={min}
        max={max}
        value={typeof value === 'number' ? value : ''}
        disabled={disabled}
        placeholder={param.default === -1 ? '-1 (random)' : 'random'}
        onChange={(e) => {
          const raw = e.target.value
          onChange(raw === '' ? undefined : Number(raw))
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(Math.floor(Math.random() * 2147483647))}
        className="btn btn-ghost shrink-0"
        title="Randomize"
      >
        <Dice size={13} />
        Roll
      </button>
    </div>
  )
}

const ACCEPT_LABEL: Record<string, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  file: 'document',
}

function acceptHint(param: ParamDef): string {
  if (!param.accept || param.accept.length === 0) return 'URL'
  return param.accept.map((a) => ACCEPT_LABEL[a] ?? a).join(' or ') + ' URL'
}

/** The `accept` attribute for a file picker, from the ParamDef's asset kinds. */
function acceptAttribute(param: ParamDef): string | undefined {
  if (!param.accept || param.accept.length === 0) return undefined
  const types = param.accept
    .filter((kind) => kind !== 'file')
    .map((kind) => `${kind}/*`)
  return types.length > 0 ? types.join(',') : undefined
}

/**
 * Picks a local file, uploads it, and hands back the Kie `fileUrl`.
 *
 * Every `*_url` field wants a URL Kie can fetch, so a local file has to make a
 * round trip through `POST /api/upload` first. That route caches the upload
 * against the file's hash, so re-using the same image across generations does
 * not re-upload it.
 */
function UploadButton({
  param,
  disabled,
  onUploaded,
}: {
  param: ParamDef
  disabled?: boolean
  onUploaded: (fileUrl: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  /** 0-1 while bytes are moving. A large file is seconds of silence otherwise. */
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const upload = async (file: File) => {
    setBusy(true)
    setProgress(null)
    setError(null)
    try {
      /*
       * `uploadInput` rather than a bare POST at `/api/upload`.
       *
       * A photograph off a phone is past the platform's 4.5 MB request-body cap
       * on its own, and that cap is enforced ahead of the route — so the old
       * code here read a plain-text `Request Entity Too Large` as JSON and
       * reported a parse error about a stray `R`. The helper routes anything
       * that size straight to the bucket and only sends the key through a
       * function. See lib/client/upload.ts.
       */
      const uploaded = await uploadInput(file, file.name, { onProgress: setProgress })
      onUploaded(uploaded.fileUrl)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
      setProgress(null)
      // Cleared so re-picking the same file fires a change event again.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={acceptAttribute(param)}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void upload(file)
        }}
      />
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        title={error ?? 'Upload a local file to Kie and use its URL'}
        className={`btn btn-sm shrink-0 text-xs ${
          error ? 'border-(--color-bad) text-(--color-bad)' : 'btn-ghost'
        }`}
      >
        <Upload size={12} />
        {busy
          ? progress !== null && progress < 1
            ? `${Math.round(progress * 100)}%`
            : 'Uploading…'
          : error
            ? 'Retry'
            : 'Upload'}
      </button>
      {/*
        Spelled out, not left in a tooltip. A failed upload that only recolours a
        small button reads as "nothing happened", and the question it prompts is
        "where did my file go?" rather than "what went wrong?".
      */}
      {error && (
        <p className="basis-full text-xs text-(--color-bad)" role="alert">
          {error}
        </p>
      )}
    </>
  )
}

export function UrlControl(props: ControlProps) {
  const { param, value, onChange, disabled, annotate } = props
  const url = typeof value === 'string' ? value : ''
  return (
    <div className="flex flex-wrap gap-2">
      <input
        className={`${inputBase} font-mono text-xs`}
        value={url}
        disabled={disabled}
        placeholder={`https://… (${acceptHint(param)})`}
        onChange={(e) => onChange(e.target.value)}
      />
      {annotate && (
        <MarkupButton
          url={url}
          disabled={disabled}
          /* A single-URL field has exactly one slot, so there is nowhere to put
             the clean original alongside the marked copy. */
          canPair={false}
          onResult={(result) => {
            onChange(result.fileUrl)
            if (result.legend) annotate.onLegend(result.legend)
          }}
        />
      )}
      {/* Before Upload, deliberately. Most of the time the file you want is
          something this studio already made, and the old answer to that was to
          go and find it on disk. */}
      <AssetPicker param={param} disabled={disabled} onPick={onChange} />
      <UploadButton param={param} disabled={disabled} onUploaded={onChange} />
    </div>
  )
}

/**
 * An ordered list of opaque strings — Gemini Omni's `audio_ids` and
 * `character_ids`.
 *
 * Deliberately NOT `UrlListControl` with the upload button hidden. These values
 * are ids minted by a separate endpoint, so there is nothing to upload and no
 * URL to paste; offering either affordance would promise a path that does not
 * exist. The monospace input and the counter are all this needs.
 */
export function StringListControl({ param, value, onChange, disabled, max }: ControlProps) {
  const list = Array.isArray(value) ? (value as string[]) : []
  const ceiling = max ?? param.maxItems

  const update = (next: string[]) => onChange(next)

  return (
    <div className="space-y-2">
      {list.map((item, index) => (
        <div key={index} className="flex gap-2">
          <input
            className={`${inputBase} font-mono text-xs`}
            value={item}
            disabled={disabled}
            placeholder={`${param.label} ${index + 1}`}
            onChange={(e) => {
              const next = [...list]
              next[index] = e.target.value
              update(next)
            }}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => update(list.filter((_, i) => i !== index))}
            className="btn btn-ghost btn-danger btn-icon shrink-0"
            aria-label="Remove"
          >
            <Close size={12} />
          </button>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={disabled || (ceiling !== undefined && list.length >= ceiling)}
          onClick={() => update([...list, ''])}
          className="btn btn-sm border-dashed border-(--color-border) text-(--color-ink-muted) hover:border-(--color-accent-line) hover:text-(--color-accent)"
        >
          <Plus size={12} />
          Add
        </button>
        {ceiling !== undefined && (
          <span className="font-mono text-xs text-(--color-ink-muted)">
            {list.length} / {ceiling}
          </span>
        )}
      </div>
    </div>
  )
}

export function UrlListControl({
  param,
  value,
  onChange,
  disabled,
  max,
  annotate,
}: ControlProps) {
  const list = Array.isArray(value) ? (value as string[]) : []
  const ceiling = max ?? param.maxItems

  const update = (next: string[]) => onChange(next.filter((v) => v !== undefined))

  /**
   * Whether the clean original can ride along with the marked-up copy.
   *
   * A local fact, not something the form has to work out: this control is the
   * only thing that knows how many slots the list has used and what its ceiling
   * currently is — and the ceiling moves, because a constraint can lower it.
   */
  const roomForClean = ceiling === undefined || list.length + 1 < ceiling

  /**
   * Replaces the row that was marked up, then appends the clean original when
   * one was asked for.
   *
   * Both in one update. Two `update` calls would each rebuild from the same
   * stale `list` closure, and the second would drop the first.
   */
  const applyMarkup = (index: number, fileUrl: string, cleanUrl: string | null) => {
    const next = [...list]
    next[index] = fileUrl
    if (cleanUrl && (ceiling === undefined || next.length < ceiling)) next.push(cleanUrl)
    update(next)
  }

  return (
    <div className="space-y-2">
      {list.map((item, index) => (
        <div key={index} className="flex flex-wrap gap-2">
          <input
            className={`${inputBase} font-mono text-xs`}
            value={item}
            disabled={disabled}
            placeholder={`https://… (${acceptHint(param)})`}
            onChange={(e) => {
              const next = [...list]
              next[index] = e.target.value
              update(next)
            }}
          />
          {annotate && (
            <MarkupButton
              url={item}
              disabled={disabled}
              canPair={roomForClean}
              onResult={(result) => {
                applyMarkup(index, result.fileUrl, result.cleanUrl)
                if (result.legend) annotate.onLegend(result.legend)
              }}
            />
          )}
          <AssetPicker
            param={param}
            disabled={disabled}
            onPick={(fileUrl) => {
              const next = [...list]
              next[index] = fileUrl
              update(next)
            }}
          />
          <UploadButton
            param={param}
            disabled={disabled}
            onUploaded={(fileUrl) => {
              const next = [...list]
              next[index] = fileUrl
              update(next)
            }}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => update(list.filter((_, i) => i !== index))}
            className="btn btn-ghost btn-danger btn-icon shrink-0"
            aria-label="Remove"
          >
            <Close size={12} />
          </button>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={disabled || (ceiling !== undefined && list.length >= ceiling)}
          onClick={() => update([...list, ''])}
          className="btn btn-sm border-dashed border-(--color-border) text-(--color-ink-muted) hover:border-(--color-accent-line) hover:text-(--color-accent)"
        >
          <Plus size={12} />
          Add {acceptHint(param)}
        </button>
        {/*
          An upload that appends. Without it an empty list has no upload path at
          all — you would have to add a blank row before you could fill it. The
          picker appends the same way, for the same reason.
        */}
        <AssetPicker
          param={param}
          // This one sits at the LEFT end of its row, so it opens rightward.
          align="left"
          disabled={disabled || (ceiling !== undefined && list.length >= ceiling)}
          onPick={(fileUrl) => update([...list, fileUrl])}
        />
        <UploadButton
          param={param}
          disabled={disabled || (ceiling !== undefined && list.length >= ceiling)}
          onUploaded={(fileUrl) => update([...list, fileUrl])}
        />
        {ceiling !== undefined && (
          <span className="font-mono text-xs text-(--color-ink-muted)">
            {list.length} / {ceiling}
          </span>
        )}
      </div>
    </div>
  )
}

export interface ColorStop {
  hex: string
  ratio: string
}

/** Kie's format, exactly: three digits, a dot, two decimals, a percent sign. */
function formatRatio(percent: number): string {
  return `${Math.min(999, Math.max(0, percent)).toFixed(2)}%`
}

function parseRatio(ratio: string): number {
  const n = Number.parseFloat(ratio)
  return Number.isFinite(n) ? n : 0
}

/**
 * Wan 2.7 Image's `color_palette`.
 *
 * Each stop is a colour AND the share of the image it should occupy — Kie
 * requires both, and rejects a ratio that is not `xx.xx%` to two decimals. The
 * percentage is therefore never typed as a raw string: the input takes a number
 * and the format is produced here, so the strict pattern cannot be missed.
 */
export function ColorListControl({ param, value, onChange, disabled }: ControlProps) {
  const list = Array.isArray(value) ? (value as ColorStop[]) : []
  const ceiling = param.maxItems ?? 10
  const floor = param.minItems ?? 0
  const total = list.reduce((sum, stop) => sum + parseRatio(stop.ratio), 0)

  const update = (index: number, patch: Partial<ColorStop>) => {
    onChange(list.map((stop, i) => (i === index ? { ...stop, ...patch } : stop)))
  }

  /** Even shares that still add to exactly 100 — the remainder goes on the first. */
  const evenly = (stops: ColorStop[]): ColorStop[] => {
    if (stops.length === 0) return stops
    const each = Math.floor((100 / stops.length) * 100) / 100
    const remainder = Math.round((100 - each * stops.length) * 100) / 100
    return stops.map((stop, i) => ({
      ...stop,
      ratio: formatRatio(i === 0 ? each + remainder : each),
    }))
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {list.map((stop, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <input
              type="color"
              className="h-8 w-8 shrink-0 cursor-pointer rounded-md border border-(--color-border) bg-transparent transition-colors duration-(--dur-fast) hover:border-(--color-border-strong) disabled:opacity-40"
              value={/^#[0-9a-f]{6}$/i.test(stop.hex) ? stop.hex : '#888888'}
              disabled={disabled}
              onChange={(e) => update(index, { hex: e.target.value })}
              aria-label={`Colour ${index + 1}`}
            />
            <code className="w-20 shrink-0 font-mono text-xs text-(--color-ink-muted)">
              {stop.hex}
            </code>
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              // Not `inputBase`: its `w-full` and a `w-24` are the same
              // specificity, so which one wins depends on stylesheet order
              // rather than on the order written here.
              className="input w-24 shrink-0 font-mono"
              value={parseRatio(stop.ratio)}
              disabled={disabled}
              onChange={(e) => update(index, { ratio: formatRatio(Number(e.target.value)) })}
              aria-label={`Colour ${index + 1} share`}
            />
            <span className="shrink-0 text-xs text-(--color-ink-muted)">% of image</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(list.filter((_, i) => i !== index))}
              className="btn btn-ghost btn-danger btn-sm btn-icon ml-auto shrink-0"
              aria-label="Remove colour"
            >
              <Close size={12} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || list.length >= ceiling}
          // Re-balanced on every add, so the shares always describe a whole
          // image. Adding a colour without rescaling the others leaves a palette
          // summing to 183%, which is not a proportion of anything.
          onClick={() => onChange(evenly([...list, { hex: '#888888', ratio: '0.00%' }]))}
          className="btn btn-sm border-dashed border-(--color-border) text-(--color-ink-muted) hover:border-(--color-accent-line) hover:text-(--color-accent)"
        >
          <Plus size={12} />
          Colour
        </button>
        {list.length > 1 && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(evenly(list))}
            className="btn btn-ghost btn-sm text-xs"
          >
            Even shares
          </button>
        )}
        <span className="mono text-(--color-ink-faint)">
          {list.length} / {ceiling}
          {list.length > 0 && ` · ${total.toFixed(2)}%`}
        </span>
      </div>

      {list.length > 0 && list.length < floor && (
        <p className="text-xs text-(--color-ink-muted)">
          Needs at least {floor} colours.
        </p>
      )}
    </div>
  )
}

