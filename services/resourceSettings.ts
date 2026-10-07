import fs from 'fs'
import { readLimits, withLimits, resourceDefaults, formatBytes, type Limits } from './resources'
import { updateResources, containerStats } from './docker'
import { usageFromStats } from './usageSampler'
import { composePathOf } from './sleepSettings'

/** The sandbox's limits from its compose file; null for one without (or unreadable). */
export function limitsOf(name: string, composePath = composePathOf(name)): Limits | null {
  try { return readLimits(fs.readFileSync(composePath, 'utf8')) } catch { return null }
}

/** What a running sandbox uses right now (a fresh docker stats reading), null if it cannot be read. */
async function memoryNow(name: string): Promise<number | null> {
  try { return usageFromStats(await containerStats(name))?.memory ?? null } catch { return null }
}

/** New limits for a sandbox: live into its container (docker update, no restart), then into its compose file. */
export async function applyLimits(
  name: string, status: string, change: Partial<Limits>,
  deps: { composePath: (n: string) => string; update: (n: string, l: Limits) => Promise<void>; freshUsage: (n: string) => Promise<number | null> } = { composePath: composePathOf, update: updateResources, freshUsage: memoryNow }
): Promise<Limits> {
  const file = deps.composePath(name)
  const text = fs.readFileSync(file, 'utf8')
  const current = readLimits(text)
  const next: Limits = { ...(current ?? resourceDefaults().limits), ...change }
  // Lowering memory under what it uses would make the kernel kill processes in it: check now, not a cached sample
  if (status === 'running' && (current === null || next.memory < current.memory)) {
    const used = await deps.freshUsage(name)
    if (used === null) throw new Error('cannot check its memory use right now: try again in a few seconds')
    if (next.memory < used) throw new Error(`now using ${formatBytes(used)}: stop the sandbox first or choose more`)
  }
  // The container first: if Docker refuses, the compose file still says what the container has
  if (status !== 'deep_sleep') await deps.update(name, next)
  fs.writeFileSync(file, withLimits(text, next))
  return next
}
