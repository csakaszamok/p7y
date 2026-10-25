import fs from 'node:fs'
import path from 'node:path'
import { writeFileAtomic } from './atomicWrite'
import { sandboxParent } from './sandboxPaths'

/**
 * When a sandbox last ran: asleep, when its container stopped (Docker's FinishedAt); in deep sleep its containers
 * are gone, so Purgatorium remembers that time in last-running.json just before taking it down. A sandbox put into
 * deep sleep before that was remembered gets an estimate: when it last showed its apps (apps.json, tcp.json,
 * hub.json are written while it runs).
 */

export interface LastRunning { at: string | null; estimated: boolean }

const FILE = 'last-running.json'
const EPOCH_2000 = Date.UTC(2000, 0, 1)
const valid = (iso: string | undefined) => {
  const t = iso ? Date.parse(iso) : NaN
  return !isNaN(t) && t >= EPOCH_2000 ? t : null
}

export function rememberLastRunning(dir: string, at: string): void {
  const t = valid(at)
  if (t === null) return
  try { writeFileAtomic(path.join(dir, FILE), JSON.stringify({ at: new Date(t).toISOString() })) } catch { /* the sandbox's directory is gone */ }
}

/** @param state its container's state, or null when it has none (deep sleep) */
export function lastRunning(state: { status: string; finishedAt?: string } | null, dir: string): LastRunning {
  if (state?.status === 'running') return { at: null, estimated: false }
  if (state) {
    const t = valid(state.finishedAt)
    if (t !== null) return { at: new Date(t).toISOString(), estimated: false }
    // Recreated while asleep and never started: its stop time is gone, estimate as for an old deep sleep
    if (state.status !== 'created') return { at: null, estimated: false }
    return estimate(dir)
  }
  try {
    const t = valid((JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8')) as { at?: string }).at)
    if (t !== null) return { at: new Date(t).toISOString(), estimated: false }
  } catch { /* not remembered: estimate */ }
  return estimate(dir)
}

/** About when it last ran: when it last showed its apps (these files are written while it runs). */
function estimate(dir: string): LastRunning {
  const seen = ['apps.json', 'tcp.json', 'hub.json']
    .map(f => { try { return fs.statSync(path.join(dir, f)).mtimeMs } catch { return 0 } })
    .reduce((a, b) => Math.max(a, b), 0)
  return seen >= EPOCH_2000 ? { at: new Date(seen).toISOString(), estimated: true } : { at: null, estimated: false }
}

/** For a sandbox by name: its container's state is read only when it is not running. */
export async function lastRunningOf(
  name: string, status: string,
  deps: { state?: (name: string) => Promise<{ status: string; finishedAt?: string } | null>; dir?: (name: string) => string } = {},
): Promise<LastRunning> {
  if (status === 'running') return { at: null, estimated: false }
  const state = deps.state ?? (async (n: string) => (await import('./docker')).getSandboxState(n))
  const dir = deps.dir ?? ((n: string) => `${sandboxParent(n)}/${n}`)
  return lastRunning(await state(name).catch(() => null), dir(name))
}
