import { currentWorkspace } from '@/lib/auth/workspace.ts'
import Link from 'next/link'

import { PinStar } from '@/components/models/PinStar.tsx'
import { PinnedModels, PinsHydrator } from '@/components/models/PinnedModels.tsx'
import { PageHeader, Section } from '@/components/shell/PageHeader.tsx'
import { ChevronRight } from '@/components/shell/icons.tsx'
import { listPins } from '@/lib/library/pins.ts'
import {
  ALL_MODELS,
  FAMILIES,
  capabilitiesOf,
  type Capability,
} from '@/lib/kie/registry/index.ts'
import { CAPABILITY_LABEL, FAMILY_LABEL } from '@/lib/models/labels.ts'

export const metadata = { title: 'Choose a model' }

/**
 * Dynamic since the pins landed: the shortlist at the top is read from the
 * database, and it is the first thing on the screen. Rendering it on the server
 * is what lets it paint with the page instead of dropping in afterwards and
 * pushing 86 rows down by three lines.
 */
export const dynamic = 'force-dynamic'

export default async function GenerateIndex() {
  const workspaceId = await currentWorkspace()
  // A first visit has no workspace yet, and no pins by definition.
  const pins = workspaceId ? await listPins(workspaceId) : []

  return (
    <main className="mx-auto max-w-4xl px-4 pt-6 pb-16">
      <PinsHydrator pins={pins} />

      <PageHeader
        title="Choose a model"
        description={`${ALL_MODELS.length} models. Every parameter of every one is editable — presets sit on top of that, never in place of it.`}
        actions={
          <Link href="/models" className="btn btn-ghost">
            Compare in the catalog
          </Link>
        }
        meta={
          /* 86 models is a long scroll, and the family is usually decided
             before the page loads. */
          FAMILIES.map((family) => (
            <a
              key={family}
              href={`#${family}`}
              className="chip transition-colors duration-(--dur-fast) hover:border-(--color-border-strong) hover:text-(--color-ink)"
            >
              {FAMILY_LABEL[family]}
              <span className="text-(--color-ink-faint)">
                {ALL_MODELS.filter((m) => m.family === family).length}
              </span>
            </a>
          ))
        }
      />

      {/* Above the families, always. The shortlist is the answer on most visits;
          the catalog below it is the answer on the rest. */}
      <Section title="Pinned">
        {/* No count in the heading: this list changes under your hands as you
            star rows below it, and a server-rendered number beside it would be
            wrong from the first click. */}
        <PinnedModels />
      </Section>

      {FAMILIES.map((family) => {
        const models = ALL_MODELS.filter((m) => m.family === family)
        const capabilities = [
          ...new Set(models.flatMap((m) => capabilitiesOf(m))),
        ]

        return (
          <section key={family} id={family} className="mt-9 scroll-mt-16">
            <div className="flex items-baseline gap-2.5 border-b border-(--color-border) pb-2.5">
              <h2 className="text-[15px] font-semibold tracking-[-0.022em]">
                {FAMILY_LABEL[family]}
              </h2>
              <span className="mono text-(--color-ink-faint)">{models.length} models</span>
            </div>

            {capabilities.map((capability) => {
              const inCapability = models.filter(
                (m) => m.capability === capability,
              )
              if (inCapability.length === 0) return null

              return (
                <div key={capability} className="mt-5">
                  <h3 className="eyebrow">{CAPABILITY_LABEL[capability]}</h3>
                  <ul className="panel-flush mt-2 divide-y divide-(--color-border)">
                    {inCapability.map((model) => (
                      /*
                        The star sits BESIDE the row link, not inside it. A
                        button nested in an anchor is invalid HTML and behaves
                        like it: the click lands on both, and the pin navigates.
                      */
                      <li key={model.slug} className="flex items-center gap-1 pr-2">
                        <Link
                          href={`/generate/${model.slug}`}
                          className="row group flex min-w-0 flex-1 items-center justify-between gap-4 px-3.5 py-2.5"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-medium">
                              {model.label}
                            </span>
                            <code className="mono mt-0.5 block truncate text-(--color-ink-faint)">
                              {model.slug}
                            </code>
                          </span>
                          <span className="flex shrink-0 items-center gap-2.5">
                            <span className="mono hidden text-(--color-ink-faint) sm:inline">
                              {model.params.length}p
                            </span>
                            <ChevronRight
                              size={13}
                              className="text-(--color-ink-faint) transition-transform duration-(--dur-fast) group-hover:translate-x-0.5"
                            />
                          </span>
                        </Link>
                        <PinStar
                          slug={model.slug}
                          label={model.label}
                          family={model.family}
                          capability={model.capability}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </section>
        )
      })}
    </main>
  )
}
