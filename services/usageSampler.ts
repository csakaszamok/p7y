import { listManagedContainers, containerStats, type DockerStats } from './docker'

export interface Usage { cpu: number; memory: number; memory_limit: number }
const cache = new Map<string, Usage>()

/** CPU in cores (as docker stats: Δcontainer / Δsystem × CPUs), memory without the page cache. */
export function usageFromStats(s: DockerStats): Usage | null {
  const dCpu = s.cpu_stats.cpu_usage.total_usage - (s.precpu_stats.cpu_usage?.total_usage ?? 0)
  const dSys = (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats.system_cpu_usage ?? 0)
  if (!s.precpu_stats.system_cpu_usage || dSys <= 0) return null
  const cpus = s.cpu_stats.online_cpus ?? 1
  const inactive = s.memory_stats.stats?.inactive_file ?? s.memory_stats.stats?.total_inactive_file ?? 0
  return {
    cpu: Math.round((dCpu / dSys) * cpus * 100) / 100,
    memory: Math.max(0, (s.memory_stats.usage ?? 0) - inactive),
    memory_limit: s.memory_stats.limit ?? 0,
  }
}

/** The last sample of a running sandbox; null if none yet (or it is not running). */
export function usageOf(name: string): Usage | null { return cache.get(name) ?? null }

export async function sampleOnce(
  deps: { list: () => Promise<Array<{ name: string; status: string }>>; stats: (n: string) => Promise<DockerStats>; timeoutMs?: number } = { list: listManagedContainers, stats: containerStats }
): Promise<void> {
  const timeoutMs = deps.timeoutMs ?? 4000
  // A stats call can hang (a container in a bad state): one must not stop the sampling for good
  const within = <T>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('stats timed out')), timeoutMs).unref?.())])
  const all = await deps.list().catch(() => [])
  const running = new Set(all.filter(s => s.status === 'running').map(s => s.name))
  for (const name of [...cache.keys()]) if (!running.has(name)) cache.delete(name)
  await Promise.all([...running].map(async name => {
    // A sandbox can go between the list and its stats: drop it, do not fail the round
    try { const u = usageFromStats(await within(deps.stats(name))); if (u) cache.set(name, u) } catch { cache.delete(name) }
  }))
}

let timer: NodeJS.Timeout | undefined
/** Samples every running sandbox every `intervalMs`; the API reads the cache (no slow stats call per request). */
export function startUsageSampler(intervalMs = 5000): void {
  if (timer) return
  let busy = false
  timer = setInterval(() => {
    if (busy) return
    busy = true
    sampleOnce().finally(() => { busy = false })
  }, intervalMs)
}
