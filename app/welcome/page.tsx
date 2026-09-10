import Link from 'next/link'

import { ApiKeyForm } from '@/components/setup/ApiKeyForm.tsx'
import { WorkspaceCard } from '@/components/setup/WorkspaceCard.tsx'
import { PageHeader, Section } from '@/components/shell/PageHeader.tsx'

export const metadata = {
  title: 'Getting started',
  description: 'Create a Kie API key and start generating.',
}

/**
 * The first-run guide.
 *
 * Written for somebody who has never heard of Kie, because that is who needs it.
 * The two things it has to get across, in this order: where a key comes from,
 * and what happens to it once it is pasted in. The second question is the one
 * people are right to ask and the one most tools never answer.
 *
 * Prices are deliberately absent. Kie changes them, this page cannot know when,
 * and a stale number here would be worse than no number at all.
 */
export default function WelcomePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 pt-6 pb-16">
      <PageHeader
        title="Getting started"
        description="Bring your own Kie API key. It stays in this browser, and every generation is billed to your own account."
      />

      <div className="mt-4 divide-y divide-(--color-border)">
        <Section
          className="pb-9"
          title="1 · Create a Kie account"
          hint="Free to sign up. You only pay for what you generate."
        >
          <ol className="space-y-4 text-[13px] leading-relaxed text-(--color-ink-muted)">
            <Step n={1}>
              Go to{' '}
              <External href="https://kie.ai">kie.ai</External> and sign up. Google
              sign-in is the quickest route; an email address works too.
            </Step>
            <Step n={2}>
              New accounts usually land with a small free credit balance, which is
              enough to try an image model or two. Video models cost considerably
              more per run than image models — worth knowing before you queue a
              batch of them.
            </Step>
            <Step n={3}>
              If you run out, add credits from the billing page in your Kie
              dashboard. This studio never charges you anything; it only ever
              spends the balance on your own key.
            </Step>
          </ol>
        </Section>

        <Section
          className="py-9"
          title="2 · Copy your API key"
          hint="One string. Treat it like a password — anyone holding it can spend your credits."
        >
          <ol className="space-y-4 text-[13px] leading-relaxed text-(--color-ink-muted)">
            <Step n={1}>
              Open{' '}
              <External href="https://kie.ai/api-key">kie.ai/api-key</External>{' '}
              while signed in. It is also reachable from the dashboard, usually
              under <em>API keys</em> or <em>Developer</em>.
            </Step>
            <Step n={2}>
              Create a key if there isn&apos;t one already, then copy it in full.
              Some dashboards show a key exactly once — if you close the page
              without copying it, generate another rather than guessing.
            </Step>
            <Step n={3}>
              Paste it below. The box checks it against Kie before saving, so you
              find out immediately if something went wrong in the copy — rather
              than twenty seconds into your first generation.
            </Step>
          </ol>

          <div className="mt-6">
            <ApiKeyForm autoFocus />
          </div>
        </Section>

        <Section
          className="py-9"
          title="3 · Where your key actually goes"
          hint="The part most tools leave vague."
        >
          <div className="space-y-4 text-[13px] leading-relaxed text-(--color-ink-muted)">
            <p>
              The key is saved in this browser&apos;s local storage and sent with
              each request to this app&apos;s own API, over HTTPS, so it can talk to
              Kie on your behalf. It is never written into a page, never put in a
              URL, and never sent anywhere other than this app.
            </p>
            <p>
              <strong className="text-(--color-ink)">
                One exception, and it is deliberate.
              </strong>{' '}
              A video can take twenty minutes, and the tab that started it is often
              long gone by the time it finishes. So when you submit a generation,
              an encrypted copy of your key is attached to that one job — enough
              for the server to poll for the result and store it — and{' '}
              <strong className="text-(--color-ink)">
                deleted the moment the job ends
              </strong>
              . Without it, closing the tab would abandon work you had already paid
              for.
            </p>
            <p>
              You can remove the key at any time from{' '}
              <Link
                href="/settings"
                className="text-(--color-accent-strong) underline decoration-dotted underline-offset-2"
              >
                Settings
              </Link>
              . If you think it has been exposed, revoke it in the Kie dashboard —
              that is the only action that actually stops it being usable.
            </p>
          </div>
        </Section>

        <Section
          className="pt-9"
          title="4 · Your workspace"
          hint="How this studio knows which generations are yours."
        >
          <WorkspaceCard />
        </Section>
      </div>

      <div className="mt-8 flex flex-wrap gap-2">
        <Link
          href="/generate"
          className="rounded-md bg-(--color-accent) px-4 py-2 text-[13px] font-medium text-(--color-accent-ink)"
        >
          Start generating
        </Link>
        <Link
          href="/models"
          className="rounded-md border border-(--color-border) px-4 py-2 text-[13px] text-(--color-ink-muted) hover:text-(--color-ink)"
        >
          Browse the model catalogue
        </Link>
      </div>
    </main>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-(--color-border) text-[11px] text-(--color-ink-faint)"
      >
        {n}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  )
}

function External({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-(--color-accent-strong) underline decoration-dotted underline-offset-2"
    >
      {children}
    </a>
  )
}
