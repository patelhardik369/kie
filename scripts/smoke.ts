/**
 * End-to-end smoke test for one model: build a minimal payload, validate it,
 * submit it, and poll to a terminal state.
 *
 * THIS SPENDS REAL CREDITS. One generation per run, at the cheapest settings the
 * model allows.
 *
 *   npm run smoke -- <model-slug> [json-input-overrides]
 *
 * Runs under plain Node with --conditions=react-server, which resolves the
 * `server-only` package to its no-op build so lib/kie can be imported outside
 * the Next server.
 */

import { getCredits } from '../lib/kie/account.ts'
import { requireModel } from '../lib/kie/registry/index.ts'
import type { ModelDefinition, ParamDef } from '../lib/kie/registry/types.ts'
import { buildRequestInput } from '../lib/kie/request.ts'
import { createTask, waitForTask } from '../lib/kie/tasks.ts'
import { validateInput } from '../lib/kie/validate.ts'

const DEFAULT_PROMPT =
  'A single ripe lemon on a plain white studio background, soft even lighting.'

/** Fields whose cheapest setting is "off". */
const COST_TOGGLES = new Set(['generate_audio', 'audio', 'sound'])

/** Prefer the smallest/cheapest option when an enum is ordered by cost. */
function cheapestEnumValue(param: ParamDef): string | number | undefined {
  const values = param.enum
  if (!values || values.length === 0) return undefined

  const ranked = ['480p', '480P', '580p', '720p', '720P', '1K', 'basic', 'std']
  for (const preferred of ranked) {
    if (values.includes(preferred)) return preferred
  }

  // Numeric-ish durations: take the smallest.
  const numeric = values
    .map((v) => (typeof v === 'number' ? v : Number(v)))
    .filter((n) => Number.isFinite(n))
  if (numeric.length === values.length) {
    const min = Math.min(...numeric)
    return typeof values[0] === 'number' ? min : String(min)
  }

  return param.default !== undefined
    ? (param.default as string | number)
    : values[0]
}

interface BuildResult {
  input: Record<string, unknown>
  missingAssets: string[]
}

function buildMinimalInput(model: ModelDefinition, prompt: string): BuildResult {
  const input: Record<string, unknown> = {}
  const missingAssets: string[] = []

  for (const param of model.params) {
    const needed = param.required && param.default === undefined

    if (param.type === 'url' || param.type === 'url[]') {
      if (needed) missingAssets.push(param.key)
      continue
    }

    if (COST_TOGGLES.has(param.key)) {
      // Always off — audio generation costs extra everywhere it appears.
      if (needed || param.default === true) input[param.key] = false
      continue
    }

    if (param.key === 'prompt') {
      input.prompt = prompt
      continue
    }

    if (needed) {
      switch (param.type) {
        case 'enum': {
          const value = cheapestEnumValue(param)
          if (value !== undefined) input[param.key] = value
          break
        }
        case 'number':
        case 'seed':
          input[param.key] = param.min ?? 0
          break
        case 'boolean':
          input[param.key] = false
          break
        case 'text':
        case 'string':
          input[param.key] = prompt
          break
        default:
          break
      }
      continue
    }

    // Not required, but override quality knobs downward to keep cost minimal.
    if (param.type === 'enum' && ['resolution', 'quality', 'mode', 'size'].includes(param.key)) {
      const value = cheapestEnumValue(param)
      if (value !== undefined) input[param.key] = value
    }
    if (param.key === 'duration' && param.type === 'enum') {
      const value = cheapestEnumValue(param)
      if (value !== undefined) input[param.key] = value
    }
    if (param.key === 'duration' && param.type === 'number' && param.min !== undefined) {
      input[param.key] = param.min
    }
    if (param.key === 'n' || param.key === 'max_images') {
      input[param.key] = 1
    }
  }

  return { input, missingAssets }
}

async function main() {
  const [slug, overridesJson] = process.argv.slice(2)

  if (!slug) {
    console.error('usage: npm run smoke -- <model-slug> [json-overrides]')
    process.exit(1)
  }

  const model = requireModel(slug)
  const built = buildMinimalInput(model, DEFAULT_PROMPT)
  const overrides = overridesJson ? JSON.parse(overridesJson) : {}
  // buildRequestInput fills required fields from their documented defaults —
  // Kie does not apply them server-side.
  const input = buildRequestInput(model, { ...built.input, ...overrides })

  console.log(`model      ${model.slug}`)
  console.log(`capability ${model.capability}`)
  console.log(`doc        ${model.docUrl}`)
  console.log(`input      ${JSON.stringify(input)}`)

  const stillMissing = built.missingAssets.filter((key) => !(key in overrides))
  if (stillMissing.length > 0) {
    console.error(
      `\nThis model needs asset URLs that cannot be invented: ${stillMissing.join(', ')}.\n` +
        `Pass them as overrides, e.g. npm run smoke -- ${slug} '{"image_url":"https://..."}'`,
    )
    process.exit(1)
  }

  const validation = validateInput(model, input)
  if (!validation.ok) {
    console.error('\nvalidation failed before spending credits:')
    for (const issue of validation.issues) {
      console.error(`  [${issue.code}] ${issue.key ?? '(payload)'}: ${issue.message}`)
    }
    process.exit(1)
  }
  console.log('validation ok')

  const before = await getCredits()
  console.log(`credits    ${before}`)

  const taskId = await createTask({ model: model.slug, input })
  console.log(`\ntaskId     ${taskId}`)

  const startedAt = Date.now()
  const task = await waitForTask(taskId, {
    timeoutMs: model.outputKind === 'video' ? 20 * 60_000 : 5 * 60_000,
    onPoll: (t, attempt) => {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0)
      console.log(`  poll ${attempt} @ ${elapsed}s -> ${t.state}`)
    },
  })

  console.log(`\nstate      ${task.state}`)
  console.log(`costTime   ${task.costTime ?? '-'}ms`)
  console.log(`credits    ${task.creditsConsumed ?? '-'} consumed`)

  if (task.state === 'fail') {
    console.error(`failCode   ${task.failCode}`)
    console.error(`failMsg    ${task.failMsg}`)
    process.exit(1)
  }

  console.log(`urls       ${task.result.urls.length}`)
  for (const url of task.result.urls) console.log(`  ${url}`)
  if (task.result.layers) console.log(`layers     ${task.result.layers.length}`)
  if (task.result.object) {
    console.log(`object     ${JSON.stringify(task.result.object).slice(0, 200)}`)
  }

  if (task.result.urls.length === 0) {
    console.error('\nsuccess state but no result URLs — resultJson parsing needs review')
    process.exit(1)
  }
  console.log('\nOK')
}

main().catch((error) => {
  console.error('\nsmoke failed:', error)
  process.exitCode = 1
})
