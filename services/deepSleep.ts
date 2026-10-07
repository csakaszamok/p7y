import fs from 'fs'
import { listManagedContainers, getSandboxState, type SandboxState } from './docker'
import { composeDown } from './compose'
import { removeProjectContainers, nudgeTraefik } from './project'
import { parseDuration } from './duration'
import { sandboxParent } from './sandboxPaths'

export type SandboxStateLike = SandboxState

const DEFAULT_INTERVAL_MS = 60_000
const EPOCH_2000 = Date.UTC(2000, 0, 1)

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Exited, labeled, and stopped for at least deep_sleep_after — or exited with a
 * network that no longer exists: it could never start again, and taking it down
 * lets the next request rebuild it (Purgatory /wake) on the current networks.
 */
export function isDeepSleepDue(state: SandboxState, now: Date): boolean {
  if (state.status !== 'exited') return false
  if (state.staleNetwork) return true
  const after = parseDuration(state.deepSleepAfter, 'mhd')
  if (after === null) return false
  const finished = Date.parse(state.finishedAt)
  if (isNaN(finished) || finished < EPOCH_2000) return false
  return now.getTime() - finished >= after
}

/** Containers and network down, volumes and files kept; the next request (or Wake) rebuilds it. */
async function takeDown(name: string): Promise<void> {
  const composePath = `${sandboxParent(name)}/${name}/docker-compose.yml`
  if (fs.existsSync(composePath)) await composeDown(composePath)
  await removeProjectContainers(name)
  await nudgeTraefik()
}

/** Deep sleep on request (the "Deep sleep" button): right away, also for a running sandbox. */
export async function deepSleepNow(name: string): Promise<void> {
  await takeDown(name)
  console.log(`[deep-sleep] ${name} put into deep sleep on request`)
}

async function deepSleepSandbox(name: string, now: Date): Promise<void> {
  // Re-check: Sablier may have started it since the scan.
  const state = await getSandboxState(name)
  if (!state || !isDeepSleepDue(state, now)) return
  await takeDown(name)
  console.log(state.staleNetwork
    ? `[deep-sleep] ${name} points at a removed network, down (the next request rebuilds it)`
    : `[deep-sleep] ${name} stopped since ${state.finishedAt}, down`)
}

export async function runDeepSleepOnce(now = new Date()): Promise<void> {
  let due: string[] = []
  try {
    for (const { name } of await listManagedContainers()) {
      const state = await getSandboxState(name)
      if (state && isDeepSleepDue(state, now)) due.push(name)
    }
  } catch (err) {
    console.error('[deep-sleep] scan failed:', errMsg(err))
    due = []
  }
  for (const name of due) {
    try {
      await deepSleepSandbox(name, now)
    } catch (err) {
      console.error(`[deep-sleep] ${name} failed:`, errMsg(err))
    }
  }
}

export function deepSleepIntervalMs(value = process.env.DEEP_SLEEP_CHECK_INTERVAL): number {
  if (value === undefined) return DEFAULT_INTERVAL_MS
  const ms = parseDuration(value, 'smh')
  if (ms === null) {
    console.warn(`[deep-sleep] invalid DEEP_SLEEP_CHECK_INTERVAL "${value}", using 1m`)
    return DEFAULT_INTERVAL_MS
  }
  return ms
}

export function startDeepSleepScheduler(): void {
  const ms = deepSleepIntervalMs()
  console.log(`[deep-sleep] checking every ${ms / 1000}s`)
  setInterval(() => { void runDeepSleepOnce() }, ms)
}
