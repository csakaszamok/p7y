import { listManagedContainers, getSandboxState } from './docker'
import { readSessionExpiries } from './sleepTimes'
import { deepSleepIntervalMs } from './deepSleep'

/**
 * Sablier only puts a sandbox to sleep once it has a session, and p7y opens one after every start it makes.
 * A sandbox started any other way (Docker restarting it, `docker compose start`, or p7y restarted while it was
 * opening the session) would run without one: never sleeping, "no traffic yet" until someone opens an app.
 * Each scan finds those and opens their session.
 */
export interface SessionWatchDeps {
  running: () => Promise<{ name: string; startedAt: string }[]>
  /** Session expiry per group, or null when Sablier's /metrics cannot be read */
  expiries: () => Promise<Map<string, number> | null>
  prime: (name: string) => Promise<boolean>
  log: (msg: string) => void
}

async function runningSandboxes(): Promise<{ name: string; startedAt: string }[]> {
  const out: { name: string; startedAt: string }[] = []
  for (const { name, status } of await listManagedContainers()) {
    if (status !== 'running') continue
    const state = await getSandboxState(name)
    if (state?.status === 'running') out.push({ name, startedAt: state.startedAt ?? '' })
  }
  return out
}

const defaults: SessionWatchDeps = {
  running: runningSandboxes,
  expiries: readSessionExpiries,
  prime: async name => (await import('./wake')).primeSablierSession(name, 3),
  log: msg => console.log(`[sleep] ${msg}`),
}

export function createSessionWatch(over: Partial<SessionWatchDeps> = {}) {
  const d = { ...defaults, ...over }
  // Sandbox → its start time, when the last scan saw it running without a session. Only the second sighting of
  // the same run counts: right after a session runs out, Sablier is stopping the sandbox, and a new session would
  // wake it again.
  let missing = new Map<string, string>()
  return {
    async runOnce(): Promise<void> {
      try {
        const expiries = await d.expiries()
        if (!expiries) return
        const seen = new Map<string, string>()
        for (const { name, startedAt } of await d.running()) {
          if (expiries.has(name)) continue
          if (missing.get(name) !== startedAt) { seen.set(name, startedAt); continue }
          d.log(`${name} was running without a Sablier session (started outside p7y?): opening one, so it sleeps after its idle timeout`)
          await d.prime(name)
        }
        missing = seen
      } catch (err) {
        console.error('[sleep] session scan failed:', err instanceof Error ? err.message : err)
      }
    },
  }
}

export function startSessionWatch(): void {
  const w = createSessionWatch()
  setInterval(() => { void w.runOnce() }, deepSleepIntervalMs())
}
