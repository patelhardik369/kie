import { ChevronRight } from '@/components/shell/icons.tsx'
import type { Trap } from '@/lib/models/traps.ts'

/**
 * Traps, rendered as expandable rows.
 *
 * Collapsed shows the headline; open shows which models fall on which side.
 * The affected slugs are listed in full rather than counted, because the actual
 * question is "is the model I am about to use one of these?"
 */

const KIND_LABEL: Record<Trap['kind'], string> = {
  type: 'type',
  enum: 'values',
  naming: 'naming',
  note: 'note',
}

const KIND_TONE: Record<Trap['kind'], string> = {
  type: 'chip-bad',
  enum: 'chip-warn',
  naming: 'chip-warn',
  note: '',
}

export function TrapList({ traps }: { traps: Trap[] }) {
  if (traps.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-(--color-border) px-4 py-8 text-center text-sm text-(--color-ink-muted)">
        No inconsistencies found across these models.
      </p>
    )
  }

  return (
    <ul className="panel-flush divide-y divide-(--color-border)">
      {traps.map((trap, index) => (
        <li key={`${trap.kind}-${trap.key ?? index}`}>
          <details className="group">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3.5 py-2.5 transition-colors duration-(--dur-fast) hover:bg-(--color-surface-hover)">
              <ChevronRight
                size={12}
                className="text-(--color-ink-faint) transition-transform duration-(--dur) group-open:rotate-90"
              />
              <span className={`chip ${KIND_TONE[trap.kind]}`}>{KIND_LABEL[trap.kind]}</span>
              <span className="text-[13px]">{renderTitle(trap.title)}</span>
              <span className="ml-auto font-mono text-[11px] text-(--color-ink-faint)">
                {trap.models.length} model{trap.models.length === 1 ? '' : 's'}
              </span>
            </summary>
            <div className="space-y-2 border-t border-(--color-border) bg-(--color-surface) px-3.5 py-3">
              <p className="text-xs leading-relaxed text-(--color-ink-muted)">
                {trap.detail}
              </p>
              <ul className="flex flex-wrap gap-1">
                {trap.models.map((slug) => (
                  <li
                    key={slug}
                    className="chip font-mono"
                  >
                    {slug}
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </li>
      ))}
    </ul>
  )
}

/** Renders the backtick spans in a trap title as code. */
function renderTitle(title: string) {
  return title.split(/(`[^`]+`)/).map((part, index) =>
    part.startsWith('`') && part.endsWith('`') ? (
      <code key={index} className="font-mono text-(--color-ink)">
        {part.slice(1, -1)}
      </code>
    ) : (
      <span key={index}>{part}</span>
    ),
  )
}
