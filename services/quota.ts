import { visibleSandboxes } from './access'
import { sandboxService } from './sandbox'
import type { Principal } from './principal'
import { rawNameOf } from './naming'

const DEFAULT_QUOTA = 3

/** SANDBOX_QUOTA: max sandboxes per user; 0 = unlimited (null). */
export function quotaLimit(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.SANDBOX_QUOTA
  if (raw === undefined || raw === '') return DEFAULT_QUOTA
  if (!/^\d+$/.test(raw)) {
    console.warn(`[quota] invalid SANDBOX_QUOTA "${raw}", using ${DEFAULT_QUOTA}`)
    return DEFAULT_QUOTA
  }
  const n = Number(raw)
  return n === 0 ? null : n
}

const DEFAULT_SERVER_LIMIT = 200

/**
 * SANDBOX_MAX_TOTAL: users' running and asleep sandboxes on the whole server (each holds a Docker network and
 * its subnet); 200 by default, 0 = none (null), invalid → default. The admin's are not counted.
 */
export function serverLimit(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.SANDBOX_MAX_TOTAL
  if (raw === undefined || raw === '') return DEFAULT_SERVER_LIMIT
  if (!/^\d+$/.test(raw)) {
    console.warn(`[quota] invalid SANDBOX_MAX_TOTAL "${raw}", using ${DEFAULT_SERVER_LIMIT}`)
    return DEFAULT_SERVER_LIMIT
  }
  return Number(raw) || null
}

/** A sandbox in deep sleep holds no slot: its containers are gone, only its data is kept. */
const awake = (s: { status: string }) => s.status !== 'deep_sleep'

/** The users' awake sandboxes on the server (the admin's do not count against SANDBOX_MAX_TOTAL). */
export async function serverUsed(): Promise<number> {
  return (await sandboxService.listSandboxes()).filter(s => (s.owner ?? 'admin') !== 'admin' && awake(s)).length
}

/** SANDBOX_QUOTA counts running sandboxes: asleep and deep-sleeping ones are free (the reward for letting them sleep). */
export function runningLimit(env: NodeJS.ProcessEnv = process.env): number | null {
  return quotaLimit(env)
}

export interface WakeRefusal { reason: 'running' | 'server'; title: string; message: string; limit: number; running: string[] }
const short = (n: string) => rawNameOf(n) ?? n
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : word.endsWith('x') ? 'es' : 's'}`

/**
 * Why this owner's sandbox (now `from`: its status) may not wake, or null: from any sleep it takes a running
 * place (SANDBOX_QUOTA); from deep sleep also a place on the server (SANDBOX_MAX_TOTAL).
 * `pending`: this owner's sandboxes being woken right now, counted as running; `creates`: their new sandboxes
 * being created (they will run); `freeing`: the running one a swap puts to sleep first (not counted). Never refuses the admin.
 */
export async function wakeRefusal(owner: string, from: string, pending: string[] = [], opts: { freeing?: string; creates?: number } = {}): Promise<WakeRefusal | null> {
  if (owner === 'admin') return null
  const all = await sandboxService.listSandboxes()
  const mine = all.filter(s => s.owner === owner)
  if (from === 'deep_sleep') {
    // Out of deep sleep it gets a Docker network again: within the server limit
    const server = serverLimit()
    if (server !== null && all.filter(s => (s.owner ?? 'admin') !== 'admin' && awake(s)).length + pending.length >= server) {
      return { reason: 'server', title: 'The server is full', limit: server, running: [],
        message: `The server is full (${server} sandboxes running or asleep): ask the administrator.` }
    }
  }
  const max = runningLimit()
  const running = [...new Set([...mine.filter(s => s.status === 'running').map(s => s.name), ...pending])].filter(n => n !== opts.freeing)
  if (max !== null && running.length + (opts.creates ?? 0) >= max) {
    return { reason: 'running', title: 'Running limit reached', limit: max, running,
      message: `Running limit reached: ${plural(max, 'running sandbox')} allowed, running now: ${running.map(short).join(', ')}. Put one to sleep first.` }
  }
  return null
}

// Sandboxes being woken per owner: a start takes seconds, and two at once must not both pass the running limit
const waking = new Map<string, Set<string>>()
export type WakeReservation = { ok: true; release: () => void } | { ok: false; refusal: WakeRefusal }

/**
 * Reserve a running slot before starting a sandbox; release() once its start finished (either way).
 * `freeing`: a swap's running sandbox that will be put to sleep first, so it does not count.
 */
export async function reserveWake(owner: string, name: string, from: string, freeing?: string): Promise<WakeReservation> {
  if (owner === 'admin') return { ok: true, release: () => {} }
  const set = waking.get(owner) ?? new Set<string>()
  waking.set(owner, set)
  const pending = [...set].filter(n => n !== name) // taken before the await: concurrent wakes see each other
  const creates = inFlight.get(owner) ?? 0 // and creates that started before this wake
  set.add(name)
  const release = () => { set.delete(name); if (!set.size && waking.get(owner) === set) waking.delete(owner) }
  const refusal = await wakeRefusal(owner, from, pending, { freeing, creates })
  if (refusal) { release(); return { ok: false, refusal } }
  return { ok: true, release }
}

/** The caller's running sandboxes and their running limit (none for the admin). */
export async function runningStatus(p: Principal): Promise<{ max_running: number | null; running: number }> {
  const running = (await visibleSandboxes(p)).filter(s => s.owner === p.sub && s.status === 'running').length
  return { max_running: p.role === 'admin' ? null : runningLimit(), running }
}

export async function quotaStatus(p: Principal): Promise<{ quota: number | null; sandbox_count: number }> {
  // Only running sandboxes count against the quota
  const count = (await visibleSandboxes(p)).filter(s => s.status === 'running').length
  return { quota: p.role === 'admin' ? null : quotaLimit(), sandbox_count: count }
}

/** The limit the caller has reached, or null if they may create another sandbox. */
export async function quotaExceeded(p: Principal): Promise<number | null> {
  const { quota, sandbox_count } = await quotaStatus(p)
  return quota !== null && sandbox_count >= quota ? quota : null
}

// Creates in flight per user. A sandbox's containers appear only after its
// compose up (20–60 s), so without this, parallel creates would all pass the
// count check. Purgatory is a single process, so in-memory is enough.
const inFlight = new Map<string, number>()

export type SlotReservation = { ok: true; release: () => void } | { ok: false; limit: number; scope: 'server' | 'running' }

/**
 * Reserve room for one more sandbox before creating it; call release() when the
 * create finished (either way). The reservation is taken before the count is
 * awaited, so concurrent requests see each other.
 */
export async function reserveSandboxSlot(p: Principal): Promise<SlotReservation> {
  // The admin is limited by neither
  if (p.role === 'admin') return { ok: true, release: () => {} }
  const server = serverLimit()
  if (server === null && runningLimit() === null) return { ok: true, release: () => {} }
  inFlight.set(p.sub, (inFlight.get(p.sub) ?? 0) + 1)
  const wakesBefore = [...(waking.get(p.sub) ?? [])] // wakes that started before this create will run too
  let released = false
  const release = () => {
    if (released) return
    released = true
    const n = (inFlight.get(p.sub) ?? 1) - 1
    if (n <= 0) inFlight.delete(p.sub)
    else inFlight.set(p.sub, n)
  }
  const max = runningLimit()
  if (max !== null) {
    // A new sandbox starts running: it needs a running slot too
    // A sandbox still finishing its wake may already run: counted once
    const running = new Set([...(await visibleSandboxes(p)).filter(s => s.status === 'running').map(s => s.name), ...wakesBefore]).size
    if (running + (inFlight.get(p.sub) ?? 0) > max) {
      release()
      return { ok: false, limit: max, scope: 'running' }
    }
  }
  if (server !== null) {
    // Every user's creates in flight count: two people must not take the server's last place together
    const flying = [...inFlight.values()].reduce((a, b) => a + b, 0)
    if ((await serverUsed()) + flying > server) {
      release()
      return { ok: false, limit: server, scope: 'server' }
    }
  }
  return { ok: true, release }
}
