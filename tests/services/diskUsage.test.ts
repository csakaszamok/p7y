import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import yaml from 'js-yaml'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-disk-'))
vi.stubEnv('DISK_USAGE_FILE', `${dir}/disk-usage.json`)

const { diskDefault, diskLimitOf, withDiskLimit, measureOnce, diskOf, _resetDiskUsage } = await import('../../services/diskUsage')

const G = 1024 ** 3
const compose = (labels: Record<string, string> = {}) => yaml.dump({ services: { sandbox: { image: 'dind', labels: { 'p7y.name': 'p7y-a', ...labels } } } })
const tempCompose = (text: string) => { const f = path.join(fs.mkdtempSync(path.join(dir, 'c-')), 'docker-compose.yml'); fs.writeFileSync(f, text); return f }

describe('disk limit', () => {
  it('SANDBOX_DISK, 20 GB by default; a bad value falls back with a warning', () => {
    expect(diskDefault({})).toEqual({ bytes: 20 * G, warnings: [] })
    expect(diskDefault({ SANDBOX_DISK: '50g' }).bytes).toBe(50 * G)
    const bad = diskDefault({ SANDBOX_DISK: 'lots' })
    expect(bad.bytes).toBe(20 * G)
    expect(bad.warnings[0]).toMatch(/SANDBOX_DISK/)
  })
  it("a sandbox's own limit is a label in its compose file, else the default", () => {
    expect(diskLimitOf('p7y-a', tempCompose(compose()))).toBe(20 * G)
    const out = withDiskLimit(compose(), 80 * G)
    expect(diskLimitOf('p7y-a', tempCompose(out))).toBe(80 * G)
    expect((yaml.load(out) as { services: { sandbox: { labels: Record<string, string> } } }).services.sandbox.labels['p7y.name']).toBe('p7y-a')
    expect(diskLimitOf('p7y-a', '/nonexistent/docker-compose.yml')).toBe(20 * G)
  })
})

describe('measureOnce', () => {
  beforeEach(() => _resetDiskUsage())
  const t0 = new Date('2026-10-05T10:00:00Z')
  const later = (min: number) => new Date(t0.getTime() + min * 60_000)

  it('measures running sandboxes again after the interval, asleep ones once after they stopped', async () => {
    const measure = vi.fn(async (n: string) => (n === 'p7y-a' ? 5 * G : 30 * G))
    let list = [{ name: 'p7y-a', status: 'running' }, { name: 'p7y-b', status: 'exited' }]
    const deps = { list: async () => list, measure, intervalMs: 15 * 60_000 }
    await measureOnce({ ...deps, now: () => t0 })
    expect(measure.mock.calls.map(c => c[0])).toEqual(['p7y-a', 'p7y-b'])
    measure.mockClear()
    await measureOnce({ ...deps, now: () => later(5) })
    expect(measure).not.toHaveBeenCalled() // a: too soon; b: asleep, already measured
    await measureOnce({ ...deps, now: () => later(16) })
    expect(measure.mock.calls.map(c => c[0])).toEqual(['p7y-a'])
    measure.mockClear()
    list = [{ name: 'p7y-a', status: 'exited' }, { name: 'p7y-b', status: 'exited' }]
    await measureOnce({ ...deps, now: () => later(17) })
    expect(measure.mock.calls.map(c => c[0])).toEqual(['p7y-a']) // once more: it changed until it stopped
    measure.mockClear()
    await measureOnce({ ...deps, now: () => later(60) })
    expect(measure).not.toHaveBeenCalled()
  })

  it('reports use against the limit, over when above it, and keeps the results across a restart', async () => {
    await measureOnce({ list: async () => [{ name: 'p7y-b', status: 'exited' }], measure: async () => 30 * G, now: () => t0, intervalMs: 1 })
    const composePath = tempCompose(compose())
    expect(diskOf('p7y-b', composePath)).toEqual({ limit: 20 * G, used: 30 * G, measured_at: t0.toISOString(), over: true })
    expect(diskOf('p7y-new', composePath)).toEqual({ limit: 20 * G, used: null, measured_at: null, over: false })
    _resetDiskUsage({ keepFile: true })
    expect(diskOf('p7y-b', composePath).used).toBe(30 * G)
  })

  it('a failed measurement leaves the last one and does not stop the round', async () => {
    const measure = vi.fn(async (n: string) => { if (n === 'p7y-a') throw new Error('no volume'); return G })
    await measureOnce({ list: async () => [{ name: 'p7y-a', status: 'running' }, { name: 'p7y-b', status: 'running' }], measure, now: () => t0, intervalMs: 1 })
    expect(diskOf('p7y-a', '/none').used).toBeNull()
    expect(diskOf('p7y-b', '/none').used).toBe(G)
  })

  it('forgets sandboxes that are gone (archived)', async () => {
    await measureOnce({ list: async () => [{ name: 'p7y-a', status: 'exited' }], measure: async () => G, now: () => t0, intervalMs: 1 })
    await measureOnce({ list: async () => [], measure: async () => G, now: () => later(1), intervalMs: 1 })
    expect(diskOf('p7y-a', '/none').used).toBeNull()
  })
})
