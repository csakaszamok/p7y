import { describe, it, expect, vi } from 'vitest'

vi.mock('../../services/docker', () => ({ listManagedContainers: vi.fn(), containerStats: vi.fn() }))
const { usageFromStats, usageOf, sampleOnce } = await import('../../services/usageSampler')

const stats = (total: number, preTotal: number, sys: number, preSys: number, extra: Record<string, unknown> = {}) => ({
  cpu_stats: { cpu_usage: { total_usage: total }, system_cpu_usage: sys, online_cpus: 20 },
  precpu_stats: { cpu_usage: { total_usage: preTotal }, system_cpu_usage: preSys },
  memory_stats: { usage: 600, limit: 4000, stats: { inactive_file: 100 } },
  ...extra,
})

describe('usageFromStats', () => {
  it('gives CPU in cores and memory without the page cache, as docker stats does', () => {
    // 1e8 ns of the container over 1e9 ns of all 20 CPUs = 0.1 × 20 = 2 cores
    expect(usageFromStats(stats(2e8, 1e8, 2e9, 1e9) as never)).toEqual({ cpu: 2, memory: 500, memory_limit: 4000 })
  })

  it('uses the cgroup v1 field name too, and gives null without a previous sample', () => {
    const v1 = stats(2e8, 1e8, 2e9, 1e9, { memory_stats: { usage: 600, limit: 4000, stats: { total_inactive_file: 200 } } })
    expect(usageFromStats(v1 as never)?.memory).toBe(400)
    expect(usageFromStats(stats(2e8, 0, 2e9, 0) as never)).toBeNull()
  })
})

describe('sampleOnce', () => {
  // A stats call that never answers must not stop sampling for good
  it('gives up on a stats call that hangs, and the others still count', async () => {
    const list = vi.fn(async () => [{ name: 'p7y-hang', status: 'running' }, { name: 'p7y-ok', status: 'running' }])
    const st = vi.fn((n: string) => (n === 'p7y-hang' ? new Promise(() => {}) : Promise.resolve(stats(2e8, 1e8, 2e9, 1e9))))
    const started = Date.now()
    await sampleOnce({ list, stats: st as never, timeoutMs: 50 })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(usageOf('p7y-ok')).toEqual({ cpu: 2, memory: 500, memory_limit: 4000 })
    expect(usageOf('p7y-hang')).toBeNull()
  })

  it('samples running sandboxes, drops stopped ones, and survives one vanishing mid-way', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce([{ name: 'p7y-a', status: 'running' }, { name: 'p7y-b', status: 'running' }, { name: 'p7y-c', status: 'exited' }])
      .mockResolvedValueOnce([{ name: 'p7y-a', status: 'exited' }])
    const st = vi.fn(async (n: string) => { if (n === 'p7y-b') throw new Error('No such container'); return stats(2e8, 1e8, 2e9, 1e9) })
    await sampleOnce({ list, stats: st as never })
    expect(usageOf('p7y-a')).toEqual({ cpu: 2, memory: 500, memory_limit: 4000 })
    expect(usageOf('p7y-b')).toBeNull()
    expect(usageOf('p7y-c')).toBeNull()
    await sampleOnce({ list, stats: st as never })
    expect(usageOf('p7y-a')).toBeNull() // asleep now
  })
})
