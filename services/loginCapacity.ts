import { serverLimit, serverUsed } from './quota'

/** The users' sandbox places on the server (SANDBOX_MAX_TOTAL): taken and the limit. */
export interface Capacity { used: number; limit: number }

export interface LoginCapacityDeps {
  used: () => Promise<number>
  limit: () => number | null
  /** LOGIN_CAPACITY=off hides it: the sign-in page is public */
  enabled: () => boolean
  now: () => number
  ttlMs: number
}

/**
 * The sign-in page shows how many sandbox places are taken and free. It needs no session, so the count is kept
 * for `ttlMs`: reloading it in a loop does not list the sandboxes every time.
 */
export function createLoginCapacity(over: Partial<LoginCapacityDeps> = {}) {
  const d: LoginCapacityDeps = {
    used: serverUsed,
    limit: () => serverLimit(),
    enabled: () => (process.env.LOGIN_CAPACITY ?? 'on').toLowerCase() !== 'off',
    now: Date.now,
    ttlMs: 30_000,
    ...over,
  }
  let cached: { at: number; used: Promise<number> } | undefined
  return {
    async get(): Promise<Capacity | null> {
      const limit = d.limit()
      if (!d.enabled() || limit === null) return null
      if (!cached || d.now() - cached.at >= d.ttlMs) cached = { at: d.now(), used: d.used() }
      try {
        return { used: await cached.used, limit }
      } catch {
        cached = undefined // try again on the next page
        return null
      }
    },
  }
}

export const loginCapacity = createLoginCapacity()

/** The line above the sign-in buttons: taken and free, and a bar; a warning from 90%, an error when full. */
export function capacityHtml(c: Capacity | null): string {
  if (!c) return ''
  const free = Math.max(0, c.limit - c.used)
  const pct = Math.min(100, Math.round((c.used / c.limit) * 100))
  const state = free === 0 ? ' full' : pct >= 90 ? ' warn' : ''
  const text = free === 0
    ? 'The server is full: no free sandbox places'
    : `Sandbox places: ${c.used} taken · ${free} free`
  return `<div class="capacity${state}"><p>${text}</p><div class="bar"><span style="width:${pct}%"></span></div></div>`
}
