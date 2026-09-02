'use client'

import { useRef, useState } from 'react'

import type { ParamDef } from '@/lib/kie/registry/types.ts'

/**
 * Leaf controls, one per ParamType.
 *
 * Nothing here knows about a model. Every control is chosen by `param.type` and
 * configured by the ParamDef, which is what lets 59 models share one form.
 */

export interface ControlProps<T = unknown> {
  param: ParamDef
  value: T
  onChange: (value: unknown) => void
  disabled?: boolean
  /** Overrides param.max when a constraint lowers it. */
  max?: number
  /**
   * Required in the CURRENT state. A constraint can make an optional field
   * required (or vice versa), so controls must not read param.required directly.
   */
  required?: boolean
}

/** The effective requiredness, honouring constraint-derived overrides. */
function isRequired(props: ControlProps): boolean {
  return props.required ?? Boolean(props.param.required)
}

const inputBase =
  'w-full rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm ' +
  'outline-none transition focus:border-(--color-accent) disabled:cursor-not-allowed disabled:opacity-40'

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
                ? 'text-red-400'
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
          className="text-xs text-(--color-ink-muted) underline transition hover:text-(--color-ink) disabled:opacity-40"
        >
          Prompts
        </button>
        {onSave.trim() && (
          <button
            type="button"
            disabled={disabled}
            onClick={save}
            className="text-xs text-(--color-ink-muted) underline transition hover:text-(--color-ink) disabled:opacity-40"
          >
            {saved ? 'Saved' : 'Save this'}
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-10 mt-1 max-h-64 w-96 overflow-y-auto rounded-md border border-(--color-border) bg-(--color-surface-raised) shadow-lg">
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
                    className="block w-full px-3 py-2 text-left transition hover:bg-(--color-accent)/10"
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
  const options = param.enum ?? []

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
              className={`rounded-md border px-3 py-1.5 font-mono text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
                selected
                  ? 'border-(--color-accent) bg-(--color-accent)/15 text-(--color-ink)'
                  : 'border-(--color-border) text-(--color-ink-muted) hover:border-(--color-ink-muted)'
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
          className="flex-1 accent-(--color-accent) disabled:opacity-40"
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
        className={`${inputBase} ${showSlider ? 'w-28' : ''} font-mono`}
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
      className={`relative h-6 w-11 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-40 ${
        on
          ? 'border-(--color-accent) bg-(--color-accent)/40'
          : 'border-(--color-border) bg-(--color-surface)'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all ${
          on ? 'left-5.5 bg-(--color-accent)' : 'left-0.5 bg-(--color-ink-muted)'
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
        className="shrink-0 rounded-md border border-(--color-border) px-3 text-sm text-(--color-ink-muted) transition hover:border-(--color-ink-muted) disabled:opacity-40"
        title="Randomize"
      >
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
  const [error, setError] = useState<string | null>(null)

  const upload = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const response = await fetch('/api/upload', { method: 'POST', body })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error ?? 'Upload failed.')
      onUploaded(data.fileUrl as string)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
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
        className={`shrink-0 rounded-md border px-3 py-1.5 text-xs transition disabled:opacity-40 ${
          error
            ? 'border-red-400 text-red-400'
            : 'border-(--color-border) text-(--color-ink-muted) hover:border-(--color-ink-muted)'
        }`}
      >
        {busy ? 'Uploading…' : error ? 'Retry' : 'Upload'}
      </button>
    </>
  )
}

export function UrlControl(props: ControlProps) {
  const { param, value, onChange, disabled } = props
  return (
    <div className="flex gap-2">
      <input
        className={`${inputBase} font-mono text-xs`}
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        placeholder={`https://… (${acceptHint(param)})`}
        onChange={(e) => onChange(e.target.value)}
      />
      <UploadButton param={param} disabled={disabled} onUploaded={onChange} />
    </div>
  )
}

export function UrlListControl({ param, value, onChange, disabled, max }: ControlProps) {
  const list = Array.isArray(value) ? (value as string[]) : []
  const ceiling = max ?? param.maxItems

  const update = (next: string[]) => onChange(next.filter((v) => v !== undefined))

  return (
    <div className="space-y-2">
      {list.map((item, index) => (
        <div key={index} className="flex gap-2">
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
            className="shrink-0 rounded-md border border-(--color-border) px-2 text-sm text-(--color-ink-muted) transition hover:border-red-400 hover:text-red-400 disabled:opacity-40"
            aria-label="Remove"
          >
            ✕
          </button>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={disabled || (ceiling !== undefined && list.length >= ceiling)}
          onClick={() => update([...list, ''])}
          className="rounded-md border border-dashed border-(--color-border) px-3 py-1.5 text-xs text-(--color-ink-muted) transition hover:border-(--color-ink-muted) disabled:cursor-not-allowed disabled:opacity-40"
        >
          + Add {acceptHint(param)}
        </button>
        {/*
          An upload that appends. Without it an empty list has no upload path at
          all — you would have to add a blank row before you could fill it.
        */}
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

export function ColorListControl({ param, value, onChange, disabled }: ControlProps) {
  const list = Array.isArray(value) ? (value as string[]) : []
  const ceiling = param.maxItems ?? 10

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {list.map((color, index) => (
          <div key={index} className="flex flex-col items-center gap-1">
            <input
              type="color"
              className="h-9 w-9 cursor-pointer rounded border border-(--color-border) bg-transparent disabled:opacity-40"
              value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#888888'}
              disabled={disabled}
              onChange={(e) => {
                const next = [...list]
                next[index] = e.target.value
                onChange(next)
              }}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(list.filter((_, i) => i !== index))}
              className="text-xs text-(--color-ink-muted) hover:text-red-400 disabled:opacity-40"
              aria-label="Remove color"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={disabled || list.length >= ceiling}
          onClick={() => onChange([...list, '#888888'])}
          className="h-9 rounded-md border border-dashed border-(--color-border) px-3 text-xs text-(--color-ink-muted) transition hover:border-(--color-ink-muted) disabled:cursor-not-allowed disabled:opacity-40"
        >
          + Color
        </button>
      </div>
      <p className="font-mono text-xs text-(--color-ink-muted)">
        {list.length} / {ceiling}
        {param.minItems !== undefined && list.length > 0 && list.length < param.minItems
          ? ` — needs at least ${param.minItems}`
          : ''}
      </p>
    </div>
  )
}

export function BboxListControl({ param, value, onChange, disabled }: ControlProps) {
  const list = Array.isArray(value) ? (value as number[][]) : []
  const ceiling = param.maxItems ?? 2

  return (
    <div className="space-y-2">
      {list.map((box, index) => (
        <div key={index} className="flex items-center gap-2">
          {(['x1', 'y1', 'x2', 'y2'] as const).map((axis, axisIndex) => (
            <label key={axis} className="flex items-center gap-1">
              <span className="font-mono text-xs text-(--color-ink-muted)">{axis}</span>
              <input
                type="number"
                className={`${inputBase} w-20 font-mono`}
                value={box[axisIndex] ?? 0}
                disabled={disabled}
                onChange={(e) => {
                  const next = list.map((b) => [...b])
                  next[index]![axisIndex] = Number(e.target.value)
                  onChange(next)
                }}
              />
            </label>
          ))}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(list.filter((_, i) => i !== index))}
            className="rounded-md border border-(--color-border) px-2 py-1 text-sm text-(--color-ink-muted) transition hover:border-red-400 hover:text-red-400 disabled:opacity-40"
            aria-label="Remove region"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled || list.length >= ceiling}
        onClick={() => onChange([...list, [0, 0, 100, 100]])}
        className="rounded-md border border-dashed border-(--color-border) px-3 py-1.5 text-xs text-(--color-ink-muted) transition hover:border-(--color-ink-muted) disabled:cursor-not-allowed disabled:opacity-40"
      >
        + Region ({list.length} / {ceiling})
      </button>
    </div>
  )
}
