/**
 * Stops whatever is serving the dev port, clears the build cache, and reports
 * what it did. Run by `npm run dev:clean`, ahead of `next dev`.
 *
 * WHY THIS EXISTS: `next dev` refuses to start when `.next/dev/lock` names a
 * live process — it prints "Another next dev server is already running" and
 * exits. Started from a second terminal, that reads as a restart that worked:
 * the command returns, the port still answers, and the browser still talks to
 * the OLD process. A dev server wedged into a worker-crash loop then survives
 * every attempt to restart it, and the symptom looks like a code bug that no
 * source change can fix.
 *
 * So this kills the listener first, and says so, rather than letting the lock
 * turn a restart into a no-op.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const PORT = Number(process.env.PORT ?? 3000)

/** PIDs listening on the port. Empty when nothing holds it. */
function listenersOn(port) {
  try {
    if (process.platform === 'win32') {
      const output = execFileSync('netstat', ['-ano'], { encoding: 'utf8' })
      const pids = output
        .split(/\r?\n/)
        .filter((line) => line.includes('LISTENING') && /:\d+\s/.test(line))
        .filter((line) => new RegExp(`[:.]${port}\\s`).test(line))
        .map((line) => Number(line.trim().split(/\s+/).pop()))
        .filter((pid) => Number.isInteger(pid) && pid > 0)
      return [...new Set(pids)]
    }

    const output = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    })
    return output.split(/\s+/).map(Number).filter(Boolean)
  } catch {
    // Nothing listening, or the tool is unavailable. Either way: nothing to kill.
    return []
  }
}

/** The executable behind a PID, so we never kill something unrelated. */
function describe(pid) {
  try {
    if (process.platform === 'win32') {
      const output = execFileSync(
        'tasklist',
        ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
        { encoding: 'utf8' },
      )
      return output.split(',')[0]?.replace(/"/g, '').trim() ?? ''
    }
    return execFileSync('ps', ['-p', String(pid), '-o', 'comm='], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return ''
  }
}

function kill(pid) {
  if (process.platform === 'win32') {
    // /T so the worker children go with the parent, not orphaned onto the port.
    execFileSync('taskkill', ['/PID', String(pid), '/F', '/T'], { stdio: 'ignore' })
  } else {
    process.kill(pid, 'SIGKILL')
  }
}

const pids = listenersOn(PORT)

for (const pid of pids) {
  const name = describe(pid)
  // Only node. A stray kill of something else on this port would be far worse
  // than leaving it alone and letting `next dev` report the conflict itself.
  if (!/^node(\.exe)?$/i.test(name)) {
    console.warn(
      `[dev:clean] port ${PORT} is held by pid ${pid} (${name || 'unknown'}), not node — leaving it alone.`,
    )
    continue
  }
  try {
    kill(pid)
    console.log(`[dev:clean] stopped the dev server on port ${PORT} (pid ${pid})`)
  } catch (error) {
    console.warn(`[dev:clean] could not stop pid ${pid}: ${error.message}`)
  }
}

if (pids.length === 0) {
  console.log(`[dev:clean] nothing was listening on port ${PORT}`)
}

// Clears the Turbopack cache and the stale lock together. The cache is worth
// dropping after a large refactor, when files it still remembers have moved.
fs.rmSync('.next', { recursive: true, force: true })
console.log('[dev:clean] cleared .next')
