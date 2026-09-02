import Link from 'next/link'

import { AssetLibrary } from '@/components/library/AssetLibrary.tsx'
import { ResumeParked } from '@/components/queue/ResumeParked.tsx'
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

export const metadata = { title: 'Settings — Kie Studio' }

/**
 * Configuration, spend, storage, and the asset library.
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
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="border-b border-(--color-border) pb-5">
        <Link href="/" className="text-sm text-(--color-ink-muted) hover:underline">
          ← Kie Studio
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Settings</h1>
      </header>

      <section className="mt-8">
        <h2 className="text-sm font-medium">Configuration</h2>
        <dl className="mt-3 divide-y divide-(--color-border) rounded-lg border border-(--color-border) bg-(--color-surface-raised)">
          {/* Present or missing — never the value itself. */}
          <Row label="KIE_API_KEY" value={env.kieApiKey ? 'configured' : 'missing'} />
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
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium">Credits</h2>
        <p className="mt-0.5 text-xs text-(--color-ink-muted)">
          Balance comes from Kie on every load. Spend comes from our own rows &mdash;
          Kie&rsquo;s logs age out after two months, which makes the local table the
          only long-term record.
        </p>

        <div className="mt-3 flex flex-wrap gap-3">
          <Stat
            label="Balance"
            value={balance.balance === null ? '—' : String(balance.balance)}
            hint={balanceHint(balance)}
          />
          <Stat label="Spent, all time" value={String(spend.totalSpent)} hint="credits" />
          <Stat label="Generations" value={String(runs)} hint="last 30 days" />
        </div>

        {balance.error && (
          <p className="mt-3 rounded border-l-2 border-amber-400 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
            Could not reach Kie for the balance: {balance.error}
          </p>
        )}

        {spend.byModel.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-lg border border-(--color-border)">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-(--color-border) bg-(--color-surface) text-xs text-(--color-ink-muted)">
                  <th className="px-3 py-2 font-medium">Model, last 30 days</th>
                  <th className="px-3 py-2 font-medium">Runs</th>
                  <th className="px-3 py-2 font-medium">Credits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-border)">
                {spend.byModel.map((row) => (
                  <tr key={row.modelSlug}>
                    <td className="px-3 py-2">
                      <Link
                        href={`/gallery?model=${encodeURIComponent(row.modelSlug)}`}
                        className="font-mono text-xs hover:underline"
                      >
                        {row.modelSlug}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{row.runs}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.credits || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium">Recovery</h2>
        <p className="mt-0.5 text-xs text-(--color-ink-muted)">
          A stalled poll and a failed download are both recoverable: the
          generation was paid for and its Kie task still exists. Neither is
          resumed automatically on restart, because a task Kie has forgotten
          would otherwise be re-polled forever.
        </p>
        <ResumeParked total={parked.total} byState={parked.byState} />
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium">Storage</h2>
        <div className="mt-3 flex flex-wrap gap-3">
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
          <p className="mt-3 text-xs text-amber-300">
            Stopped counting at 20,000 files; the total above is a lower bound.
          </p>
        )}

        {disk.byFolder.length > 0 && (
          <ul className="mt-3 divide-y divide-(--color-border) overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface-raised)">
            {disk.byFolder.map((folder) => (
              <li
                key={folder.name}
                className="flex items-baseline justify-between gap-4 px-3 py-2"
              >
                <span className="truncate font-mono text-xs">{folder.name}</span>
                <span className="shrink-0 font-mono text-xs text-(--color-ink-muted)">
                  {folder.files} files · {formatBytes(folder.bytes)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 border-t border-(--color-border) pt-6">
        <h2 className="text-sm font-medium">Asset library</h2>
        <p className="mt-0.5 text-xs text-(--color-ink-muted)">
          Files used as model inputs. A Kie upload lasts about{' '}
          {Math.round(UPLOAD_TTL_MS / 3_600_000)} hours; the local copy is kept, so
          an expired asset re-uploads on next use rather than being lost.
        </p>
        <div className="mt-3">
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
        </div>
      </section>
    </main>
  )
}

/** Live readings say nothing; a stale one has to say how stale, and why. */
function balanceHint(balance: BalanceReading): string {
  if (balance.live) return 'live from Kie'
  if (balance.recordedAt) return `last reading ${formatTimestamp(balance.recordedAt)}`
  return 'unavailable'
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 px-4 py-3">
      <dt className="shrink-0 text-sm text-(--color-ink-muted)">{label}</dt>
      <dd className="truncate font-mono text-sm" title={value}>
        {value}
      </dd>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-(--color-border) bg-(--color-surface-raised) px-4 py-3">
      <div className="font-mono text-xl">{value}</div>
      <div className="text-xs text-(--color-ink-muted)">{label}</div>
      {hint && <div className="text-[11px] text-(--color-ink-muted)">{hint}</div>}
    </div>
  )
}
