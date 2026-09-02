import 'server-only'

import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Disk usage under KIE_OUTPUT_DIR, for Settings.
 *
 * Walks the tree rather than asking the OS, because there is no portable way to
 * ask "how big is this directory" and the alternative — summing `assets.bytes`
 * — would miss the `_inputs` cache and anything written outside the app.
 */

export interface DiskUsage {
  bytes: number
  files: number
  /** Largest subdirectories, biggest first. */
  byFolder: { name: string; bytes: number; files: number }[]
  /** True when the walk stopped early; the numbers are then a lower bound. */
  truncated: boolean
  /** Absent when the directory does not exist yet. */
  missing: boolean
}

/** A local studio's output folder is not unbounded, but a runaway walk would be. */
const MAX_ENTRIES = 20_000

export async function measureOutputDir(root: string): Promise<DiskUsage> {
  const usage: DiskUsage = {
    bytes: 0,
    files: 0,
    byFolder: [],
    truncated: false,
    missing: false,
  }

  try {
    await fs.access(root)
  } catch {
    usage.missing = true
    return usage
  }

  const folders = new Map<string, { bytes: number; files: number }>()

  async function walk(dir: string, top: string) {
    if (usage.files >= MAX_ENTRIES) {
      usage.truncated = true
      return
    }

    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      // An unreadable folder is reported as zero rather than failing the page.
      return
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        await walk(full, top || entry.name)
        continue
      }
      if (!entry.isFile()) continue

      try {
        const stat = await fs.stat(full)
        usage.bytes += stat.size
        usage.files += 1

        const key = top || '(root)'
        const bucket = folders.get(key)
        if (bucket) {
          bucket.bytes += stat.size
          bucket.files += 1
        } else {
          folders.set(key, { bytes: stat.size, files: 1 })
        }
      } catch {
        // A file that vanished mid-walk simply is not counted.
      }

      if (usage.files >= MAX_ENTRIES) {
        usage.truncated = true
        return
      }
    }
  }

  await walk(root, '')

  usage.byFolder = [...folders.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 12)

  return usage
}
