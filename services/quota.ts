import { visibleSandboxStates } from './access'
import { sandboxService } from './sandbox'
import type { Principal } from './principal'
import type { SandboxMeta } from './docker'
import { rawNameOf } from './naming'

const DEFAULT_QUOTA = 3

/** SANDBOX_QUOTA: the running sandboxes guaranteed to each user; 0 = unlimited (null). */
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
 * SANDBOX_MAX_TOTAL: the running sandboxes on the whole server (asleep and deep-sleeping ones take no place, so letting
 * a sandbox sleep frees it for everyone); 200 by default, 0 = none (null), invalid → default. The admin's count too,
 * but the admin is never refused.
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

/** Only a running sandbox takes a place on the server: asleep or in deep sleep it takes none. */
const isRunning = (s: { status: string }) => s.status === 'running'

/** The places taken on the server (SANDBOX_MAX_TOTAL): every running sandbox, the admin's too. */
export async function serverUsed(all?: SandboxMeta[]): Promise<number> {
  return (all ?? await sandboxService.listSandboxStates()).filter(isRunning).length
}

/**
 * SANDBOX_QUOTA_MAX: how many may run while the server has room, above the guarantee (SANDBOX_QUOTA).
 * Unset = the guarantee (no extra); 0 = no maximum (null); below the guarantee or invalid → the guarantee.
 */
export function quotaMax(env: NodeJS.ProcessEnv = process.env): number | null {
  const guarantee = quotaLimit(env)
  if (guarantee === null) return null
  const raw = env.SANDBOX_QUOTA_MAX
  if (raw === undefined || raw === '') return guarantee
  if (!/^\d+$/.test(raw)) {
    console.warn(`[quota] invalid SANDBOX_QUOTA_MAX "${raw}", using SANDBOX_QUOTA (${guarantee})`)
    return guarantee
  }
  const n = Number(raw)
  if (n === 0) return null
  if (n < guarantee) {
    console.warn(`[quota] SANDBOX_QUOTA_MAX ${n} is below SANDBOX_QUOTA ${guarantee}, using ${guarantee}`)
    return guarantee
  }
  return n
}

/** The running limit: SANDBOX_QUOTA_MAX (the guarantee when unset). Asleep and deep-sleeping ones are free (the reward for letting them sleep). */
export function runningLimit(env: NodeJS.ProcessEnv = process.env): number | null {
  return quotaMax(env)
}

/**
 * Server places `owner` must leave free when going above their guarantee: what every other owner lacks of their
 * guarantee (a running sandbox holds its place already; asleep or in deep sleep it holds none), and one newcomer's guarantee
 * (someone without a sandbox yet is not known). The admin is never refused, so nothing is kept for them.
 */
export function reservedFor(owner: string, states: { owner?: string; status: string }[], guarantee: number): number {
  const held = new Map<string, number>()
  for (const s of states) {
    const o = s.owner ?? 'admin'
    if (o === owner || o === 'admin') continue
    held.set(o, (held.get(o) ?? 0) + (isRunning(s) ? 1 : 0))
  }
  return [...held.values()].reduce((sum, n) => sum + Math.max(0, guarantee - n), 0) + guarantee
}

/** Why a sandbox above the guarantee may not take a new place now. */
export const roomMessage = (guarantee: number, reserved: number) =>
  `${plural(guarantee, 'running sandbox')} guaranteed; more only while the server has room, and it has none to spare now: ${plural(reserved, 'place')} ${reserved === 1 ? 'is' : 'are'} kept for the others' guarantees. Put one to sleep first.`

export interface WakeRefusal { reason: 'running' | 'server' | 'room'; title: string; message: string; limit: number; running: string[] }
const short = (n: string) => rawNameOf(n) ?? n
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : word.endsWith('x') ? 'es' : 's'}`

/**
 * Why this owner's sandbox (now `from`: its status) may not wake, or null: from any sleep it takes a running
 * place of its owner's (SANDBOX_QUOTA) and one on the server (SANDBOX_MAX_TOTAL).
 * `pending`: this owner's sandboxes being woken right now, counted as running; `creates`: their new sandboxes
 * being created (they will run); `freeing`: the running one a swap puts to sleep first (not counted). Never refuses the admin.
 */
export async function wakeRefusal(owner: string, from: string, pending: string[] = [], opts: { freeing?: string; creates?: number } = {}): Promise<WakeRefusal | null> {
  if (owner === 'admin') return null
  const all = await sandboxService.listSandboxStates()
  const mine = all.filter(s => s.owner === owner)
  // Running, it takes a place on the server (the admin's running ones take theirs too)
  const server = serverLimit()
  const taken = all.filter(s => isRunning(s) && s.name !== opts.freeing).length + pending.length
  if (server !== null && taken >= server) {
    return { reason: 'server', title: 'The server is full', limit: server, running: [],
      message: `The server is full (${server} sandboxes running): ask the administrator.` }
  }
  const max = runningLimit()
  const running = [...new Set([...mine.filter(s => s.status === 'running').map(s => s.name), ...pending])].filter(n => n !== opts.freeing)
  if (max !== null && running.length + (opts.creates ?? 0) >= max) {
    return { reason: 'running', title: 'Running limit reached', limit: max, running,
      message: `Running limit reached: ${plural(max, 'running sandbox')} allowed, running now: ${running.map(short).join(', ')}. Put one to sleep first.` }
  }
  // Above the guarantee (any wake takes a place): only if the others keep room for theirs
  const guarantee = quotaLimit()
  if (guarantee !== null && server !== null && running.length + (opts.creates ?? 0) >= guarantee) {
    const reserved = reservedFor(owner, all, guarantee)
    if (taken + 1 + reserved > server) {
      return { reason: 'room', title: 'No room above your guarantee', limit: guarantee, running, message: roomMessage(guarantee, reserved) }
    }
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
export async function runningStatus(p: Principal, all?: SandboxMeta[]): Promise<{ max_running: number | null; running: number }> {
  const running = (await visibleSandboxStates(p, all)).filter(s => s.owner === p.sub && s.status === 'running').length
  return { max_running: p.role === 'admin' ? null : runningLimit(), running }
}

export async function quotaStatus(p: Principal, all?: SandboxMeta[]): Promise<{ quota: number | null; sandbox_count: number }> {
  // Only running sandboxes count against the quota
  const count = (await visibleSandboxStates(p, all)).filter(s => s.status === 'running').length
  return { quota: p.role === 'admin' ? null : quotaLimit(), sandbox_count: count }
}

/** The limit the caller has reached, or null if they may create another sandbox. */
export async function quotaExceeded(p: Principal): Promise<number | null> {
  const { quota, sandbox_count } = await quotaStatus(p)
  return quota !== null && sandbox_count >= quota ? quota : null
}

// Creates in flight per user. A sandbox's containers appear only after its
// compose up (20–60 s), so without this, parallel creates would all pass the
// count check. Purgatorium is a single process, so in-memory is enough.
const inFlight = new Map<string, number>()

export type SlotReservation = { ok: true; release: () => void } | { ok: false; limit: number; scope: 'server' | 'running' | 'room'; message?: string }

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
  const guarantee = quotaLimit()
  // A new sandbox starts running: it needs a running slot too
  // A sandbox still finishing its wake may already run: counted once
  const runningAfter = guarantee === null ? 0
    : new Set([...(await visibleSandboxStates(p)).filter(s => s.status === 'running').map(s => s.name), ...wakesBefore]).size + (inFlight.get(p.sub) ?? 0)
  if (max !== null && runningAfter > max) {
    release()
    return { ok: false, limit: max, scope: 'running' }
  }
  if (server !== null) {
    // Every user's creates in flight count: two people must not take the server's last place together
    const flying = [...inFlight.values()].reduce((a, b) => a + b, 0)
    const all = await sandboxService.listSandboxStates()
    const used = all.filter(isRunning).length
    if (used + flying > server) {
      release()
      return { ok: false, limit: server, scope: 'server' }
    }
    // Above the guarantee: only while every other owner (and a newcomer) keeps room for theirs
    if (guarantee !== null && runningAfter > guarantee) {
      const reserved = reservedFor(p.sub, all, guarantee)
      if (used + flying + reserved > server) {
        release()
        return { ok: false, limit: guarantee, scope: 'room', message: roomMessage(guarantee, reserved) }
      }
    }
  }
  return { ok: true, release }
}
