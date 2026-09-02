import Link from 'next/link'

import { AssetLibrary } from '@/components/library/AssetLibrary.tsx'
import { ResumeParked } from '@/components/queue/ResumeParked.tsx'
import { PageHeader, Section } from '@/components/shell/PageHeader.tsx'
import { AccentPicker } from '@/components/theme/AccentPicker.tsx'
import { formatBytes, formatTimestamp } from '@/lib/gallery/display.ts'
import { readBalance, type BalanceReading } from '@/lib/library/balance.ts'
import { measureOutputDir } from '@/lib/library/disk.ts'
import {
  getSpendSummary,
  libraryCounts,
  listInputAssets,
  parkedCounts,
  UPLOAD_TTL_MS,
} from '@/lib/library/queries.ts'
import { getEnv } from '@/lib/env'
import { ALL_MODELS } from '@/lib/kie/registry/index.ts'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Settings' }

/**
 * Appearance, configuration, spend, storage, and the asset library.
 *
 * The API key is reported as present or missing and never rendered — it lives
 * server-side and no route echoes it.
 */
export default async function SettingsPage() {
  const env = getEnv()
  const [spend, counts, assets, disk, parked] = await Promise.all([
    getSpendSummary(30),
    libraryCounts(),
    listInputAssets(),
    measureOutputDir(env.outputDir),
    parkedCounts(),
  ])

  // Asked of Kie on every load, falling back to the last logged reading. Reading
  // the log alone is what left this card empty: nothing wrote to it.
  const balance = await readBalance({
    balance: spend.balance,
    recordedAt: spend.balanceRecordedAt,
  })
  const runs = spend.byModel.reduce((total, row) => total + row.runs, 0)

  return (
    <main className="mx-auto max-w-4xl px-4 pt-6 pb-16">
      <PageHeader
        title="Settings"
        description="Appearance, environment, spend and the files this studio keeps on disk."
      />

      <Section
        className="mt-2"
        title="Appearance"
        hint="Stored in this browser only — nothing about the theme reaches Kie or the database."
      >
        <AccentPicker />
      </Section>

      <Section className="mt-8" title="Configuration">
        <dl className="panel-flush divide-y divide-(--color-border)">
          {/* Present or missing — never the value itself. */}
          <Row
            label="KIE_API_KEY"
            value={env.kieApiKey ? 'configured' : 'missing'}
            tone={env.kieApiKey ? 'ok' : 'bad'}
          />
          <Row label="Database" value={env.databaseFile} />
          <Row label="Output directory" value={env.outputDir} />
          <Row
            label="Webhooks"
            value={
              env.publicUrl
                ? `${env.publicUrl}/api/kie/webhook`
                : 'disabled — no KIE_PUBLIC_URL, so polling is the only completion path'
            }
          />
          <Row
            label="Callback role"
            value={
              env.publicUrl
                ? 'wakes the poller early; never authoritative'
                : 'n/a — Kie cannot reach localhost'
            }
          />
          <Row label="Models in registry" value={`${ALL_MODELS.length}`} />
        </dl>
      </Section>

      <Section
        className="mt-8"
        title="Credits"
        hint="Balance comes from Kie on every load. Spend comes from our own rows — Kie's logs age out after two months, which makes the local table the only long-term record."
      >
        <div className="grid-divided grid-cols-2 sm:grid-cols-3">
          <Stat
            label="Balance"
            value={balance.balance === null ? '—' : String(balance.balance)}
            hint={balanceHint(balance)}
            emphasis
          />
          <Stat label="Spent, all time" value={String(spend.totalSpent)} hint="credits" />
          <Stat label="Generations" value={String(runs)} hint="last 30 days" />
        </div>

        {balance.error && (
          <p className="note note-warn mt-3 text-xs">
            Could not reach Kie for the balance: {balance.error}
          </p>
        )}

        {spend.byModel.length > 0 && (
          <div className="panel-flush mt-4">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-(--color-border) bg-(--color-surface)">
                  <Th>Model, last 30 days</Th>
                  <Th>Runs</Th>
                  <Th>Credits</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-border)">
                {spend.byModel.map((row) => (
                  <tr
                    key={row.modelSlug}
                    className="transition-colors duration-(--dur-fast) hover:bg-(--color-surface-hover)"
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/gallery?model=${encodeURIComponent(row.modelSlug)}`}
                        className="mono underline-offset-4 hover:text-(--color-accent) hover:underline"
                      >
                        {row.modelSlug}
                      </Link>
                    </td>
                    <td className="mono px-3 py-2">{row.runs}</td>
                    <td className="mono px-3 py-2">{row.credits || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        className="mt-8"
        title="Recovery"
        hint="A stalled poll and a failed download are both recoverable: the generation was paid for and its Kie task still exists. Neither is resumed automatically on restart, because a task Kie has forgotten would otherwise be re-polled forever."
      >
        <ResumeParked total={parked.total} byState={parked.byState} />
      </Section>

      <Section className="mt-8" title="Storage">
        <div className="grid-divided grid-cols-2 sm:grid-cols-4">
          <Stat label="On disk" value={formatBytes(disk.bytes)} hint={`${disk.files} files`} />
          <Stat label="Presets" value={String(counts.presets)} />
          <Stat label="Prompts" value={String(counts.prompts)} />
          <Stat label="Input assets" value={String(counts.inputAssets)} />
        </div>

        {disk.missing && (
          <p className="mt-3 text-xs text-(--color-ink-muted)">
            The output directory does not exist yet — it is created on the first
            download.
          </p>
        )}
        {disk.truncated && (
          <p className="note note-warn mt-3 text-xs">
            Stopped counting at 20,000 files; the total above is a lower bound.
          </p>
        )}

        {disk.byFolder.length > 0 && (
          <ul className="panel-flush mt-3 divide-y divide-(--color-border)">
            {disk.byFolder.map((folder) => (
              <li
                key={folder.name}
                className="flex items-baseline justify-between gap-4 px-3.5 py-2"
              >
                <span className="mono truncate">{folder.name}</span>
                <span className="mono shrink-0 text-(--color-ink-faint)">
                  {folder.files} files · {formatBytes(folder.bytes)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        className="mt-8"
        title="Asset library"
        hint={`Files used as model inputs. A Kie upload lasts about ${Math.round(
          UPLOAD_TTL_MS / 3_600_000,
        )} hours; the local copy is kept, so an expired asset re-uploads on next use rather than being lost.`}
      >
        <AssetLibrary
          initialAssets={assets.map((asset) => ({
            id: asset.id,
            kind: asset.kind,
            label: asset.label,
            bytes: asset.bytes,
            localPath: asset.localPath,
            createdAt: asset.createdAt,
            live: asset.live,
            expiresAt: asset.expiresAt,
          }))}
        />
      </Section>
    </main>
  )
}

/** Live readings say nothing; a stale one has to say how stale, and why. */
function balanceHint(balance: BalanceReading): string {
  if (balance.live) return 'live from Kie'
  if (balance.recordedAt) return `last reading ${formatTimestamp(balance.recordedAt)}`
  return 'unavailable'
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-[11px] font-medium text-(--color-ink-muted)">{children}</th>
  )
}

function Row({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'ok' | 'bad'
}) {
  return (
    <div className="flex items-baseline justify-between gap-6 px-3.5 py-2.5">
      <dt className="shrink-0 text-[13px] text-(--color-ink-muted)">{label}</dt>
      <dd
        className={`mono truncate ${
          tone === 'ok'
            ? 'text-(--color-ok-ink)'
            : tone === 'bad'
              ? 'text-(--color-bad-ink)'
              : 'text-(--color-ink-muted)'
        }`}
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string
  value: string
  hint?: string
  emphasis?: boolean
}) {
  return (
    <div className="px-3.5 py-3">
      <div
        className={`num text-[19px] leading-none font-semibold tracking-[-0.03em] ${
          emphasis ? 'text-(--color-accent)' : ''
        }`}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11px] text-(--color-ink-muted)">{label}</div>
      {hint && <div className="mt-0.5 text-[10px] text-(--color-ink-faint)">{hint}</div>}
    </div>
  )
}
