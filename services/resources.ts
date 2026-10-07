import yaml from 'js-yaml'

/** A sandbox's CPU (cores) and memory (bytes) limit. */
export interface Limits { cpus: number; memory: number }
const K = 1024
const M = K * K
const G = M * K
const MIN_MEMORY = 64 * M

export function parseCpus(v: unknown): number | null {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const n = Number(s)
  return n > 0 ? n : null
}

/** `512m`, `4g`, `1.5G`, `65536k` → bytes. */
export function parseMemory(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const m = /^(\d+(?:\.\d+)?)([kmg])$/i.exec(v.trim())
  if (!m) return null
  const n = Number(m[1]) * { k: K, m: M, g: G }[m[2].toLowerCase() as 'k' | 'm' | 'g']
  return n > 0 ? Math.round(n) : null
}

export const memoryForCompose = (bytes: number): string => `${Math.round(bytes / M)}m`

export function formatBytes(bytes: number): string {
  if (bytes >= G) return `${Number((bytes / G).toFixed(1))} GB`
  return `${Math.round(bytes / M)} MB`
}

/** Limits every sandbox gets (SANDBOX_CPUS, SANDBOX_MEMORY) and how far a user may raise them (SANDBOX_MAX_*). */
export function resourceDefaults(env: NodeJS.ProcessEnv = process.env): { limits: Limits; ceiling: Limits; warnings: string[] } {
  const warnings: string[] = []
  const cpus = (key: string, fallback: string) => {
    const raw = env[key]
    if (raw === undefined || raw === '') return Number(fallback)
    const v = parseCpus(raw)
    if (v === null) { warnings.push(`${key}=${raw} is not a number of CPUs like 2 or 0.5: using ${fallback}`); return Number(fallback) }
    return v
  }
  const mem = (key: string, fallback: string) => {
    const raw = env[key]
    if (raw === undefined || raw === '') return parseMemory(fallback)!
    const v = parseMemory(raw)
    if (v === null) { warnings.push(`${key}=${raw} is not a memory size like 4g: using ${fallback}`); return parseMemory(fallback)! }
    return v
  }
  return {
    limits: { cpus: cpus('SANDBOX_CPUS', '2'), memory: mem('SANDBOX_MEMORY', '4g') },
    ceiling: { cpus: cpus('SANDBOX_MAX_CPUS', '4'), memory: mem('SANDBOX_MAX_MEMORY', '8g') },
    warnings,
  }
}

/** What a request may set: users up to the ceiling, the admin up to the host. */
export function checkLimits(
  req: { cpus?: unknown; memory?: unknown }, role: 'user' | 'admin', ctx: { ceiling: Limits; host: Limits }
): { ok: true; cpus?: number; memory?: number } | { ok: false; status: 400 | 403; error: string } {
  const out: { ok: true; cpus?: number; memory?: number } = { ok: true }
  // A user's ceiling, but never more than the host has (Docker would refuse it at create)
  const userMax = { cpus: Math.min(ctx.ceiling.cpus, ctx.host.cpus), memory: Math.min(ctx.ceiling.memory, ctx.host.memory) }
  const cpuMax = role === 'admin' ? ctx.host.cpus : userMax.cpus
  if (req.cpus !== undefined) {
    const c = parseCpus(req.cpus)
    if (c === null || c < 0.1 || (role === 'admin' && c > ctx.host.cpus)) return { ok: false, status: 400, error: `cpus must be a number between 0.1 and ${cpuMax}` }
    if (role === 'user' && c > userMax.cpus) return { ok: false, status: 403, error: `at most ${userMax.cpus} CPUs for a sandbox: ask the administrator for more` }
    out.cpus = c
  }
  if (req.memory !== undefined) {
    const m = parseMemory(req.memory)
    if (m === null || m < MIN_MEMORY) return { ok: false, status: 400, error: 'memory must look like 512m or 4g, at least 64m' }
    if (role === 'admin' && m > ctx.host.memory) return { ok: false, status: 400, error: `memory can be at most ${formatBytes(ctx.host.memory)}` }
    if (role === 'user' && m > userMax.memory) return { ok: false, status: 403, error: `at most ${formatBytes(userMax.memory)} memory for a sandbox: ask the administrator for more` }
    out.memory = m
  }
  return out
}

type Services = Record<string, Record<string, unknown>>

/** The limits in a sandbox's compose file; null for one created before limits (or unreadable). */
export function readLimits(composeText: string): Limits | null {
  try {
    const sb = ((yaml.load(composeText) as { services?: Services } | null)?.services ?? {}).sandbox
    if (!sb || sb.cpus === undefined || sb.mem_limit === undefined) return null
    const cpus = parseCpus(sb.cpus)
    const memory = parseMemory(String(sb.mem_limit))
    return cpus !== null && memory !== null ? { cpus, memory } : null
  } catch { return null }
}

/** The compose file with these limits on the sandbox container (no swap beyond the memory limit). */
export function withLimits(composeText: string, limits: Limits): string {
  const doc = (yaml.load(composeText) ?? {}) as { services?: Services }
  const sb = doc.services?.sandbox
  if (!sb) throw new Error('This sandbox has no sandbox service in its compose file')
  sb.cpus = limits.cpus
  sb.mem_limit = memoryForCompose(limits.memory)
  sb.memswap_limit = memoryForCompose(limits.memory)
  return yaml.dump(doc, { lineWidth: -1 })
}

/** Limits no bigger than the host (a default of 2 CPUs on a 1-CPU machine would make every create fail). */
export function clampToHost(limits: Limits, host: Limits): Limits {
  return { cpus: Math.min(limits.cpus, host.cpus), memory: Math.min(limits.memory, host.memory) }
}
