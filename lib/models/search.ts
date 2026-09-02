import type { Capability, Family, ModelDefinition } from '../kie/registry/types.ts'

/**
 * Searching the catalog.
 *
 * Pure module. Matches across the things you would actually search by — the
 * slug, the label, the capabilities, the parameter names, and the notes — so
 * "does anything take an audio input?" and "which models have cfg_scale?" both
 * work, not just a label prefix.
 */

export interface ModelQuery {
  q?: string
  family?: Family
  capability?: Capability
  /** Only models with a parameter of this exact key. */
  paramKey?: string
}

function haystack(model: ModelDefinition): string {
  return [
    model.slug,
    model.label,
    model.capability,
    ...(model.alsoSupports ?? []),
    model.family,
    model.notes ?? '',
    ...model.params.map((p) => `${p.key} ${p.label}`),
  ]
    .join(' ')
    .toLowerCase()
}

export function searchModels(
  models: ModelDefinition[],
  query: ModelQuery,
): ModelDefinition[] {
  const terms = (query.q ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  return models.filter((model) => {
    if (query.family && model.family !== query.family) return false

    if (query.capability) {
      const serves = [model.capability, ...(model.alsoSupports ?? [])]
      if (!serves.includes(query.capability)) return false
    }

    if (query.paramKey && !model.params.some((p) => p.key === query.paramKey)) {
      return false
    }

    if (terms.length === 0) return true

    // Every term must match somewhere — narrowing, not widening, so adding a
    // word always shortens the list.
    const text = haystack(model)
    return terms.every((term) => text.includes(term))
  })
}

/** Parameter keys shared across the catalog, for the "has parameter" filter. */
export function commonParamKeys(
  models: ModelDefinition[],
  minModels = 2,
): { key: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const model of models) {
    for (const key of new Set(model.params.map((p) => p.key))) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= minModels)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/** The asset inputs a model takes, summarized for a list row. */
export function assetInputs(model: ModelDefinition): string[] {
  return model.params
    .filter((p) => p.type === 'url' || p.type === 'url[]')
    .map((p) => {
      const kinds = p.accept?.join('/') ?? 'file'
      const many = p.type === 'url[]'
      const cap = many && p.maxItems ? ` ×${p.maxItems}` : many ? ' ×n' : ''
      return `${p.key}: ${kinds}${cap}`
    })
}
