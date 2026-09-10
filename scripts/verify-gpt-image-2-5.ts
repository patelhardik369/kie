/**
 * One-off verification for the GPT Image 2.5 registry entries.
 *
 *   node --conditions=react-server scripts/verify-gpt-image-2-5.ts
 *
 * Exercises the four endpoints end to end WITHOUT spending credits: what the
 * form opens on, what `buildRequestInput` would actually POST, and whether the
 * documented "27:16, 16:27, 9:8 and 8:9 support 1K only" restriction is
 * enforced by the constraint layer rather than merely described in help text.
 */

import { deriveFields } from '../lib/kie/constraints.ts'
import { getModel } from '../lib/kie/registry/index.ts'
import { buildRequestInput } from '../lib/kie/request.ts'
import { openingValues } from '../lib/kie/studio-defaults.ts'
import { validateInput } from '../lib/kie/validate.ts'

const SLUGS = [
  'gpt-image-2-5-flare-text-to-image',
  'gpt-image-2-5-flare-image-to-image',
  'gpt-image-2-5-sunburst-text-to-image',
  'gpt-image-2-5-sunburst-image-to-image',
]

let failures = 0

function check(label: string, condition: boolean, detail = '') {
  if (!condition) failures += 1
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}

for (const slug of SLUGS) {
  const model = getModel(slug)
  if (!model) {
    console.log(`\n=== ${slug}\n  FAIL not in the registry`)
    failures += 1
    continue
  }

  console.log(`\n=== ${slug}   [${model.label}]`)

  const opening = openingValues(model)
  console.log(`  opens on ${JSON.stringify(opening)}`)

  const filled: Record<string, unknown> = { ...opening, prompt: 'a rainy neon street' }
  if (model.params.some((p) => p.key === 'input_urls')) {
    filled.input_urls = ['https://example.com/a.png']
  }

  const clean = validateInput(model, filled)
  check('a filled form validates', clean.ok, JSON.stringify(clean.issues))

  const payload = buildRequestInput(model, filled)
  console.log(`  POST input ${JSON.stringify(payload)}`)

  // The restriction, exercised through the constraint layer.
  for (const ratio of ['9:8', '27:16', '16:27', '8:9']) {
    const options = deriveFields(model, { ...filled, aspect_ratio: ratio }).resolution?.options
    check(`${ratio} narrows resolution to 1K`, JSON.stringify(options) === '["1K"]', JSON.stringify(options))
  }

  for (const ratio of ['auto', '21:9', '16:9']) {
    const options = deriveFields(model, { ...filled, aspect_ratio: ratio }).resolution?.options
    // `auto` is capped on GPT Image 2 and NOT on 2.5 — the regression to watch.
    check(`${ratio} keeps every tier`, options === undefined, JSON.stringify(options))
  }

  const tooBig = validateInput(model, { ...filled, aspect_ratio: '9:8', resolution: '4K' })
  check('9:8 at 4K is rejected before the round trip', !tooBig.ok)

  const wrongGeneration = validateInput(model, { ...filled, aspect_ratio: '2:1' })
  check('2:1 (a GPT Image 2 ratio) is rejected', !wrongGeneration.ok)

  check('offers no background field', !model.params.some((p) => p.key === 'background'))
}

console.log(failures === 0 ? '\nOK — all four endpoints behave as documented' : `\n${failures} failure(s)`)
if (failures > 0) process.exitCode = 1
