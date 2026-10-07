import { getSandboxState } from './docker'
import { parseDuration } from './duration'

const METRIC = 'sablier_session_expires_at_timestamp_seconds'
const LINE = new RegExp(`^${METRIC}\\{([^}]*)\\}\\s+(\\S+)`)

export interface SleepTimes {
  /** When Sablier stops the sandbox if no more requests arrive (running with an active session). */
  stops_at: string | null
  /** Seconds until stops_at by the server's clock: clients count down from this, so their own clock does not matter. */
  stops_in: number | null
  /** When Purgatory takes the asleep sandbox down (asleep and deep_sleep_after is a duration). */
  deep_sleep_at: string | null
  /** Seconds until deep_sleep_at by the server's clock. */
  deep_sleep_in: number | null
  /** The sandbox's deep_sleep_after label ("7d", "off", …), or null if unknown. */
  deep_sleep_after: string | null
}

/** Sablier /metrics → earliest session expiry (unix seconds) per group. */
export function parseSessionExpiries(text: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const line of text.split('\n')) {
    const m = LINE.exec(line)
    if (!m) continue
    const group = /(?:^|,)group="([^"]*)"/.exec(m[1])?.[1]
    const value = Number(m[2])
    if (!group || !Number.isFinite(value)) continue
    const seconds = Math.round(value)
    out.set(group, Math.min(out.get(group) ?? seconds, seconds))
  }
  return out
}

/** Read-only: scraping /metrics never renews a session. Unreachable Sablier → no data. */
async function sessionExpiries(): Promise<Map<string, number>> {
  const base = process.env.SABLIER_URL ?? 'http://sablier:10000'
  try {
    const res = await fetch(`${base}/metrics`, { signal: AbortSignal.timeout(2_000) })
    if (!res.ok) return new Map()
    return parseSessionExpiries(await res.text())
  } catch {
    return new Map()
  }
}

export function sleepTimes(name: string, now = new Date()): Promise<SleepTimes> {
  return sleepTimesWith(name, now, onceExpiries())
}

/** Sleep times for many sandboxes; Sablier's /metrics is read at most once. */
export async function sleepTimesMany(names: string[], now = new Date()): Promise<Map<string, SleepTimes>> {
  const expiries = onceExpiries()
  const entries = await Promise.all(names.map(async n => [n, await sleepTimesWith(n, now, expiries)] as const))
  return new Map(entries)
}

/** Lazily fetch the session expiries on first use and share the result. */
function onceExpiries(): () => Promise<Map<string, number>> {
  let pending: Promise<Map<string, number>> | undefined
  return () => (pending ??= sessionExpiries())
}

async function sleepTimesWith(name: string, now: Date, expiries: () => Promise<Map<string, number>>): Promise<SleepTimes> {
  const state = await getSandboxState(name)
  const secondsUntil = (ms: number) => Math.max(0, Math.round((ms - now.getTime()) / 1000))
  if (!state) return { stops_at: null, stops_in: null, deep_sleep_at: null, deep_sleep_in: null, deep_sleep_after: null }
  const deepSleepAfter = state.deepSleepAfter ?? null

  if (state.status === 'running') {
    const expiry = (await expiries()).get(name)
    const live = expiry !== undefined && expiry * 1000 > now.getTime()
    return {
      stops_at: live ? new Date(expiry * 1000).toISOString() : null,
      stops_in: live ? secondsUntil(expiry * 1000) : null,
      deep_sleep_at: null, deep_sleep_in: null, deep_sleep_after: deepSleepAfter
    }
  }

  const after = parseDuration(deepSleepAfter, 'mhd')
  const finished = Date.parse(state.finishedAt)
  const due = state.status === 'exited' && after !== null && !isNaN(finished) && finished > Date.UTC(2000, 0, 1)
  return {
    stops_at: null, stops_in: null,
    deep_sleep_at: due ? new Date(finished + after!).toISOString() : null,
    deep_sleep_in: due ? secondsUntil(finished + after!) : null,
    deep_sleep_after: deepSleepAfter
  }
}
