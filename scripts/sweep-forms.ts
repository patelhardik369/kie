/**
 * Phase 3 verification: every model's page must render EVERY parameter.
 *
 * Fetches all 59 generate pages against a running server and asserts that each
 * top-level parameter key appears in the HTML — which is only true because the
 * advanced section stays mounted when collapsed.
 *
 *   npm run sweep            (expects a server on :3210)
 *   npm run sweep -- 3000
 */

import { ALL_MODELS } from '../lib/kie/registry/index.ts'

const port = process.argv[2] ?? '3210'
const base = `http://localhost:${port}`

interface Failure {
  slug: string
  problem: string
}

async function main() {
  const failures: Failure[] = []
  let totalParams = 0
  let totalNested = 0

  for (const model of ALL_MODELS) {
    const url = `${base}/generate/${model.slug}`
    let html: string

    try {
      const response = await fetch(url)
      if (!response.ok) {
        failures.push({ slug: model.slug, problem: `HTTP ${response.status}` })
        continue
      }
      html = await response.text()
    } catch (error) {
      failures.push({ slug: model.slug, problem: `fetch failed: ${String(error)}` })
      continue
    }

    const missing = model.params.filter((p) => !html.includes(`>${p.key}</code>`))
    if (missing.length > 0) {
      failures.push({
        slug: model.slug,
        problem: `missing controls: ${missing.map((p) => p.key).join(', ')}`,
      })
    }

    // The model's own label and slug should be on the page.
    if (!html.includes(model.slug)) {
      failures.push({ slug: model.slug, problem: 'slug not rendered' })
    }

    totalParams += model.params.length
    totalNested += model.params.reduce((sum, p) => sum + (p.fields?.length ?? 0), 0)
  }

  console.log(`models         ${ALL_MODELS.length}`)
  console.log(`top-level params rendered ${totalParams}`)
  console.log(`nested fields defined     ${totalNested}`)

  if (failures.length > 0) {
    console.error(`\n${failures.length} failing page(s):`)
    for (const failure of failures) {
      console.error(`  ${failure.slug}: ${failure.problem}`)
    }
    process.exitCode = 1
    return
  }

  console.log('\nOK — every model renders every parameter')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
