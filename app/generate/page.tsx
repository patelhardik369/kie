import Link from 'next/link'

import { PageHeader } from '@/components/shell/PageHeader.tsx'
import { ChevronRight } from '@/components/shell/icons.tsx'
import {
  ALL_MODELS,
  FAMILIES,
  capabilitiesOf,
  type Capability,
  type Family,
} from '@/lib/kie/registry/index.ts'

const FAMILY_LABEL: Record<Family, string> = {
  kling: 'Kling',
  bytedance: 'ByteDance',
  wan: 'Wan',
}

const CAPABILITY_LABEL: Record<Capability, string> = {
  'text-to-video': 'Text to video',
  'image-to-video': 'Image to video',
  'reference-to-video': 'Reference to video',
  'video-to-video': 'Video to video',
  'speech-to-video': 'Speech to video',
  'motion-control': 'Motion control',
  avatar: 'Avatar',
  'text-to-image': 'Text to image',
  'image-to-image': 'Image to image',
  'layer-decomposition': 'Layer decomposition',
}

export const metadata = { title: 'Choose a model' }

export default function GenerateIndex() {
  return (
    <main className="mx-auto max-w-4xl px-4 pt-6 pb-16">
      <PageHeader
        title="Choose a model"
        description={`${ALL_MODELS.length} models. Every parameter of every one is editable — presets sit on top of that, never in place of it.`}
        actions={
          <Link href="/models" className="btn btn-ghost">
            Compare in the catalog
          </Link>
        }
        meta={
          /* 59 models is a long scroll, and the family is usually decided
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
                      <li key={model.slug}>
                        <Link
                          href={`/generate/${model.slug}`}
                          className="row group flex items-center justify-between gap-4 px-3.5 py-2.5"
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
