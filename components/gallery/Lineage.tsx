import Link from 'next/link'

import { formatTimestamp, promptOf, stateLabel, stateTone } from '@/lib/gallery/display.ts'

/**
 * Where a generation came from, and what came of it.
 *
 * One hop in each direction, deliberately. The question a person actually has
 * is "what did I change from, and what did I try next" — a full ancestry walk
 * would be a graph nobody reads.
 *
 * This is how iteration becomes visible (docs/UX-SPEC.md), and it is the whole
 * reason `parent_id` and `batch_id` exist on the row.
 */

export interface LineageRow {
  id: string
  modelSlug: string
  state: string
  createdAt: number
  inputJson: string
  /**
   * Marked private. Lineage still lists it — you are inside the one generation
   * it relates to, having asked for it by id — but it says so, because
   * following the link leads somewhere you may not want on screen.
   */
  nsfw?: boolean
}

export function Lineage({
  parent,
  children,
  siblings,
  batchId,
}: {
  parent?: LineageRow
  children: LineageRow[]
  siblings: LineageRow[]
  batchId: string | null
}) {
  const nothing = !parent && children.length === 0 && siblings.length === 0

  if (nothing) {
    return (
      <p className="text-sm text-(--color-ink-muted)">
        This generation has no lineage yet. Re-running or tweaking it will record
        this one as the parent.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {parent && (
        <Section
          title="Re-run or tweaked from"
          hint="The generation these parameters came from."
          rows={[parent]}
        />
      )}

      {siblings.length > 0 && (
        <Section
          title={`Same sweep (${siblings.length} other run${siblings.length === 1 ? '' : 's'})`}
          hint={
            batchId
              ? `Submitted together as batch ${batchId.slice(0, 8)} — every run shares one parent.`
              : undefined
          }
          rows={siblings}
        />
      )}

      {children.length > 0 && (
        <Section
          title={`Led to (${children.length})`}
          hint="Generations re-run or tweaked from this one."
          rows={children}
        />
      )}
    </div>
  )
}

function Section({
  title,
  hint,
  rows,
}: {
  title: string
  hint?: string
  rows: LineageRow[]
}) {
  // What actually differs across these runs. A sweep's rows share everything but
  // the swept parameter, so listing the prompt on each would render five
  // identical lines and hide the one thing worth comparing.
  const varying = varyingKeys(rows)

  return (
    <section>
      <h3 className="text-xs font-medium tracking-wider text-(--color-ink-muted) uppercase">
        {title}
      </h3>
      {hint && <p className="mt-0.5 text-xs text-(--color-ink-muted)">{hint}</p>}
      <ul className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <RowLink key={row.id} row={row} varying={varying} />
        ))}
      </ul>
    </section>
  )
}

/** Keys whose value is not the same across every row. */
function varyingKeys(rows: LineageRow[]): string[] {
  if (rows.length < 2) return []

  const inputs = rows.map((row) => (safeParse(row.inputJson) ?? {}) as Record<string, unknown>)
  const keys = new Set(inputs.flatMap((input) => Object.keys(input)))

  return [...keys].filter((key) => {
    const seen = new Set(inputs.map((input) => JSON.stringify(input[key])))
    return seen.size > 1
  })
}

function RowLink({ row, varying }: { row: LineageRow; varying: string[] }) {
  const input = (safeParse(row.inputJson) ?? {}) as Record<string, unknown>
  const prompt = promptOf(input)
  const differences = varying.filter((key) => key in input)

  return (
    <li>
      <Link
        href={`/gallery/${row.id}`}
        className="flex items-center gap-3 rounded-md border border-(--color-border) bg-(--color-surface-raised) px-3 py-2 transition hover:border-(--color-ink-muted)"
      >
        <span
          className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] ${stateTone(row.state)}`}
        >
          {stateLabel(row.state)}
        </span>

        {row.nsfw && (
          <span className="shrink-0 rounded-full border border-fuchsia-400/50 bg-fuchsia-400/10 px-1.5 py-0.5 text-[11px] text-fuchsia-300">
            NSFW
          </span>
        )}

        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {differences.length > 0 ? (
            differences.map((key) => (
              <span
                key={key}
                className="rounded border border-(--color-accent)/40 bg-(--color-accent)/10 px-1.5 py-0.5 font-mono text-[11px]"
              >
                {key}={JSON.stringify(input[key])}
              </span>
            ))
          ) : (
            <span className="min-w-0 truncate text-xs">
              {prompt ?? <code className="font-mono">{row.modelSlug}</code>}
            </span>
          )}
        </span>

        <span className="shrink-0 font-mono text-[11px] text-(--color-ink-muted)">
          {formatTimestamp(row.createdAt)}
        </span>
      </Link>
    </li>
  )
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}
