import type { ModelDefinition, ParamDef } from '@/lib/kie/registry/types.ts'

/**
 * Every parameter that produced a generation, as a readable table.
 *
 * This is the provenance promise: no output exists without the parameters that
 * made it (docs/PRD.md F4). Three things it deliberately does:
 *
 *   - **Shows what was sent, not what the form would show now.** The rows come
 *     from the stored `input_json`, so a registry change cannot rewrite history.
 *   - **Flags keys the registry no longer knows.** A parameter Kie has since
 *     renamed still appears, marked, rather than vanishing from the record.
 *   - **Marks values that match the documented default**, so a deliberate change
 *     reads as deliberate.
 */

export function ParamProvenance({
  model,
  input,
}: {
  /** Absent when the model has been dropped from the registry since. */
  model?: ModelDefinition
  input: Record<string, unknown>
}) {
  const byKey = new Map((model?.params ?? []).map((p) => [p.key, p]))
  const sent = Object.entries(input)

  // Documented parameters that were not sent. Part of the record: "we omitted
  // negative_prompt" is as much a fact about this run as any value.
  const omitted = (model?.params ?? []).filter((p) => !(p.key in input))

  if (sent.length === 0) {
    return (
      <p className="text-sm text-(--color-ink-muted)">
        This generation stored no parameters.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="panel-flush table-scroll">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-(--color-border) bg-(--color-surface) text-xs text-(--color-ink-muted)">
              <th className="px-3 py-2 font-medium">Parameter</th>
              <th className="px-3 py-2 font-medium">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--color-border)">
            {sent.map(([key, value]) => (
              <Row key={key} paramKey={key} value={value} param={byKey.get(key)} />
            ))}
          </tbody>
        </table>
      </div>

      {omitted.length > 0 && (
        <details className="panel-flush">
          <summary className="cursor-pointer px-3 py-2 text-xs text-(--color-ink-muted)">
            {omitted.length} documented parameter{omitted.length === 1 ? '' : 's'} not sent
          </summary>
          <ul className="flex flex-wrap gap-1.5 border-t border-(--color-border) px-3 py-2.5">
            {omitted.map((param) => (
              <li
                key={param.key}
                title={param.describe}
                className="rounded border border-(--color-border) px-1.5 py-0.5 font-mono text-[11px] text-(--color-ink-muted)"
              >
                {param.key}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function Row({
  paramKey,
  value,
  param,
}: {
  paramKey: string
  value: unknown
  param?: ParamDef
}) {
  const isDefault = param?.default !== undefined && sameValue(param.default, value)

  return (
    <tr className="align-top">
      <td className="w-2/5 px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-medium">{param?.label ?? paramKey}</span>
          {/* Verbatim key, always: this is what you would search the docs for. */}
          <code className="font-mono text-[11px] text-(--color-ink-muted)">
            {paramKey}
          </code>
          {!param && (
            <span
              title="Not in the current registry — Kie may have renamed or removed it since this ran."
              className="rounded border border-(--color-warn)/50 bg-(--color-warn)/10 px-1 py-0.5 text-[10px] text-(--color-warn)"
            >
              unknown
            </span>
          )}
          {isDefault && (
            <span className="rounded border border-(--color-border) px-1 py-0.5 text-[10px] text-(--color-ink-muted)">
              default
            </span>
          )}
        </div>
        {param?.describe && (
          <p className="mt-1 text-xs leading-snug text-(--color-ink-muted)">
            {param.describe}
          </p>
        )}
      </td>
      <td className="px-3 py-2">
        <ValueCell value={value} />
      </td>
    </tr>
  )
}

function ValueCell({ value }: { value: unknown }) {
  if (typeof value === 'string' && value.length > 120) {
    return (
      <p className="font-mono text-xs leading-relaxed whitespace-pre-wrap">{value}</p>
    )
  }

  if (Array.isArray(value)) {
    return (
      <ul className="space-y-1">
        {value.map((item, index) => (
          <li key={index} className="font-mono text-xs break-all">
            {typeof item === 'string' && /^https?:\/\//.test(item) ? (
              <a
                href={item}
                target="_blank"
                rel="noreferrer"
                // Input URLs expire after about 24h; the link is provenance,
                // not a promise that it still resolves.
                title="Original input URL — Kie uploads expire after about 24 hours"
                className="underline decoration-dotted hover:text-(--color-accent)"
              >
                {item}
              </a>
            ) : (
              JSON.stringify(item)
            )}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <code className="font-mono text-xs break-all">{JSON.stringify(value)}</code>
  )
}

/** Structural equality, so an array default is not reported as changed. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}
