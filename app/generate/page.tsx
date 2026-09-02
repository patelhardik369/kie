import Link from 'next/link'

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

export default function GenerateIndex() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="border-b border-(--color-border) pb-6">
        <Link href="/" className="text-sm text-(--color-ink-muted) hover:underline">
          ← Kie Studio
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Choose a model</h1>
        <p className="mt-1.5 text-sm text-(--color-ink-muted)">
          {ALL_MODELS.length} models. Every parameter of every one is editable.
        </p>
      </header>

      {FAMILIES.map((family) => {
        const models = ALL_MODELS.filter((m) => m.family === family)
        const capabilities = [
          ...new Set(models.flatMap((m) => capabilitiesOf(m))),
        ]

        return (
          <section key={family} className="mt-10">
            <h2 className="flex items-baseline gap-3 text-lg font-medium">
              {FAMILY_LABEL[family]}
              <span className="font-mono text-xs text-(--color-ink-muted)">
                {models.length} models
              </span>
            </h2>

            {capabilities.map((capability) => {
              const inCapability = models.filter(
                (m) => m.capability === capability,
              )
              if (inCapability.length === 0) return null

              return (
                <div key={capability} className="mt-5">
                  <h3 className="text-xs font-medium tracking-wider text-(--color-ink-muted) uppercase">
                    {CAPABILITY_LABEL[capability]}
                  </h3>
                  <ul className="mt-2 divide-y divide-(--color-border) overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface-raised)">
                    {inCapability.map((model) => (
                      <li key={model.slug}>
                        <Link
                          href={`/generate/${model.slug}`}
                          className="flex items-baseline justify-between gap-4 px-4 py-3 transition hover:bg-(--color-accent)/10"
                        >
                          <span className="text-sm font-medium">{model.label}</span>
                          <span className="shrink-0 font-mono text-xs text-(--color-ink-muted)">
                            {model.slug}
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
