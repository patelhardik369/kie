import Link from 'next/link'

import { AssetLibrary } from '@/components/library/AssetLibrary.tsx'
import { ResumeParked } from '@/components/queue/ResumeParked.tsx'
import { ApiKeyForm } from '@/components/setup/ApiKeyForm.tsx'
import { CreditsCard } from '@/components/setup/CreditsCard.tsx'
import { NoWorkspace } from '@/components/setup/NoWorkspace.tsx'
import { WorkspaceCard } from '@/components/setup/WorkspaceCard.tsx'
import { PageHeader, Section } from '@/components/shell/PageHeader.tsx'
import { AccentPicker } from '@/components/theme/AccentPicker.tsx'
import { currentWorkspace } from '@/lib/auth/workspace.ts'
import { formatBytes } from '@/lib/gallery/display.ts'
import {
  getSpendSummary,
  libraryCounts,
  listInputAssets,
  parkedCounts,
  UPLOAD_TTL_MS,
} from '@/lib/library/queries.ts'
import { readUsage, format as formatStorage, WARN_FRACTION } from '@/lib/storage/quota.ts'
import { getEnv } from '@/lib/env'
import { ALL_MODELS } from '@/lib/kie/registry/index.ts'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Settings' }

/**
 * Credentials, appearance, configuration, spend, storage, and the asset library.
 *
 * The API key is never rendered by the server, because the server does not have
 * it: it lives in the browser and only the browser can show it. That inversion
 * is why the key card and the balance are client components on an otherwise
 * server-rendered page.
 */
export default async function SettingsPage() {
  const env = getEnv()
  const workspaceId = await currentWorkspace()

  if (!workspaceId) {
    return (
      <main className="mx-auto max-w-4xl px-4 pt-6 pb-16">
        <PageHeader
          title="Settings"
          description="Credentials, storage and the files this studio keeps."
        />
        <Section className="mt-2" title="Your API key">
          <ApiKeyForm />
        </Section>
        <Section className="mt-8" title="Your workspace">
          <WorkspaceCard />
        </Section>
        <NoWorkspace what="settings" />
      </main>
    )
  }

  const [spend, counts, assets, usage, parked] = await Promise.all([
    getSpendSummary(workspaceId, 30),
    libraryCounts(workspaceId),
    listInputAssets(workspaceId),
    readUsage(workspaceId),
    parkedCounts(workspaceId),
  ])

  const runs = spend.byModel.reduce((total, row) => total + row.runs, 0)
  const percent = Math.min(100, Math.round(usage.fraction * 100))

  return (
    <main className="mx-auto max-w-4xl px-4 pt-6 pb-16">
      <PageHeader
        title="Settings"
        description="Credentials, appearance, spend and the storage this studio uses."
      />

      <Section
        className="mt-2"
        title="Your API key"
        hint="Saved in this browser and sent with each request. This server keeps no key of its own — see /welcome for what happens to it."
      >
        <ApiKeyForm />
      </Section>

      <Section
        className="mt-8"
        title="Your workspace"
        hint="The id every generation, preset and prompt of yours is filed under. There are no accounts, so this string is the only way back to your work."
      >
        <WorkspaceCard />
      </Section>

      <Section
        className="mt-8"
        title="Appearance"
        hint="Stored in this browser only — nothing about the theme reaches Kie or the database."
      >
        <AccentPicker />
      </Section>

      <Section
        className="mt-8"
        title="Storage"
        hint="Outputs and input files live in Supabase Storage. The ceiling below is the whole project's, shared across every workspace on this deployment."
      >
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-(--color-surface-hover)"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Storage used"
        >
          <div
            className={`h-full rounded-full transition-[width] ${
              usage.full
                ? 'bg-(--color-bad)'
                : usage.warn
                  ? 'bg-(--color-warn)'
                  : 'bg-(--color-accent)'
            }`}
            style={{ width: `${Math.max(percent, 1)}%` }}
          />
        </div>
        <p className="mt-2 text-[13px] text-(--color-ink-muted)">
          <span className="text-(--color-ink)">{formatStorage(usage.totalBytes)}</span> of{' '}
          {formatStorage(usage.quotaBytes)} used ({percent}%) —{' '}
          {formatStorage(usage.workspaceBytes)} of it yours.
        </p>

        {usage.full ? (
          <p className="note note-bad mt-3 text-xs">
            Storage is full. New generations are refused until space is freed —
            delete some from the{' '}
            <Link href="/gallery" className="underline underline-offset-2">
              gallery
            </Link>
            , which removes their files as well as their rows.
          </p>
        ) : usage.warn ? (
          <p className="note note-warn mt-3 text-xs">
            Past {Math.round(WARN_FRACTION * 100)}% of the quota. A handful more
            videos will fill it — deleting a generation reclaims its bytes
            immediately.
          </p>
        ) : null}

        {usage.oversizeCount > 0 ? (
          <p className="note note-warn mt-3 text-xs">
            {usage.oversizeCount} of your outputs were larger than the{' '}
            {Math.round(usage.maxFileBytes / (1024 * 1024))} MB per-file ceiling
            and were never stored. They are still on Kie for about fourteen days
            from their generation — open them and download them before that.
          </p>
        ) : null}

        <div className="grid-divided mt-4 grid-cols-2 sm:grid-cols-4">
          <Stat label="Your files" value={formatBytes(usage.workspaceBytes)} />
          <Stat label="Presets" value={String(counts.presets)} />
          <Stat label="Prompts" value={String(counts.prompts)} />
          <Stat label="Input assets" value={String(counts.inputAssets)} />
        </div>
      </Section>

      <Section
        className="mt-8"
        title="Credits"
        hint="The balance is read live using the key in this browser. Spend comes from our own rows — Kie's logs age out after two months, which makes this table the only long-term record."
      >
        <div className="grid-divided grid-cols-2 sm:grid-cols-3">
          <div className="px-3.5 py-3">
            <div className="text-[11px] text-(--color-ink-muted)">Balance</div>
            <CreditsCard fallback={spend.balance} />
          </div>
          <Stat label="Spent, all time" value={String(spend.totalSpent)} hint="credits" />
          <Stat label="Generations" value={String(runs)} hint="last 30 days" />
        </div>

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
        hint="A stalled poll and a failed store are both recoverable: the generation was paid for and its Kie task still exists. Neither is resumed on a timer, because a task Kie has forgotten would otherwise be re-polled forever."
      >
        <ResumeParked total={parked.total} byState={parked.byState} />
      </Section>

      <Section className="mt-8" title="Configuration">
        <dl className="panel-flush divide-y divide-(--color-border)">
          <Row
            label="Server fallback key"
            value={
              env.kieApiKey
                ? 'set — used when a request brings no key of its own'
                : 'none — every request must bring its own key'
            }
          />
          <Row label="Database" value={hostOf(env.databaseUrl)} />
          <Row label="Storage bucket" value={env.storageBucket} />
          <Row
            label="Per-file ceiling"
            value={`${Math.round(env.maxFileBytes / (1024 * 1024))} MB`}
          />
          <Row
            label="Webhooks"
            value={
              env.publicUrl
                ? `${env.publicUrl}/api/kie/webhook`
                : 'disabled — no KIE_PUBLIC_URL, so scheduled ticks are the only completion path'
            }
          />
          <Row
            label="Callback role"
            value={
              env.publicUrl
                ? 'brings the next poll forward; never authoritative'
                : 'n/a — Kie has no public URL to call'
            }
          />
          <Row label="Models in registry" value={`${ALL_MODELS.length}`} />
        </dl>
      </Section>

      <Section
        className="mt-8"
        title="Asset library"
        hint={`Files used as model inputs. A Kie upload lasts about ${Math.round(
          UPLOAD_TTL_MS / 3_600_000,
        )} hours; our own copy is kept, so an expired asset re-uploads on next use rather than being lost.`}
      >
        <AssetLibrary
          initialAssets={assets.map((asset) => ({
            id: asset.id,
            kind: asset.kind,
            label: asset.label,
            bytes: asset.bytes,
            storagePath: asset.storagePath,
            createdAt: asset.createdAt,
            live: asset.live,
            expiresAt: asset.expiresAt,
          }))}
        />
      </Section>
    </main>
  )
}

/** The connection host alone. A connection string carries a password. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'unparseable'
  }
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
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3.5 py-2">
      <dt className="min-w-40 text-[11px] text-(--color-ink-muted)">{label}</dt>
      <dd
        className={`mono min-w-0 flex-1 break-all ${
          tone === 'ok'
            ? 'text-(--color-ok-ink)'
            : tone === 'bad'
              ? 'text-(--color-bad-ink)'
              : 'text-(--color-ink)'
        }`}
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
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="px-3.5 py-3">
      <div className="text-[11px] text-(--color-ink-muted)">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tracking-[-0.02em] text-(--color-ink)">
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[11px] text-(--color-ink-faint)">{hint}</div> : null}
    </div>
  )
}
