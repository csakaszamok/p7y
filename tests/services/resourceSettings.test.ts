import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const { applyLimits } = await import('../../services/resourceSettings')
const G = 1024 ** 3
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-res-'))
const file = path.join(dir, 'docker-compose.yml')
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('applyLimits', () => {
  beforeEach(() => fs.writeFileSync(file, 'services:\n  sandbox:\n    image: x\n    cpus: 2\n    mem_limit: 4096m\n    memswap_limit: 4096m\n'))
  // freshUsage: what the sandbox uses right now (null: could not be read)
  const deps = (usage: number | null, update = vi.fn(async () => {})) => ({
    composePath: () => file, update, freshUsage: vi.fn(async () => usage),
  })

  it('updates a running container in place, then writes the compose file', async () => {
    const d = deps(1 * G)
    expect(await applyLimits('p7y-x', 'running', { cpus: 1 }, d)).toEqual({ cpus: 1, memory: 4 * G })
    expect(fs.readFileSync(file, 'utf8')).toContain('cpus: 1\n')
    expect(d.update).toHaveBeenCalledWith('p7y-x', { cpus: 1, memory: 4 * G })
    expect(d.freshUsage).not.toHaveBeenCalled() // memory not lowered: nothing to check
  })

  it('refuses memory below what a running sandbox uses now, changing nothing', async () => {
    const before = fs.readFileSync(file, 'utf8')
    const d = deps(3 * G)
    await expect(applyLimits('p7y-x', 'running', { memory: 2 * G }, d)).rejects.toThrow('now using 3 GB: stop the sandbox first or choose more')
    expect(fs.readFileSync(file, 'utf8')).toBe(before)
    expect(d.update).not.toHaveBeenCalled()
  })

  // e.g. it just woke: lowering blind could make the kernel kill processes in it
  it('refuses to lower memory of a running sandbox whose use cannot be read', async () => {
    const before = fs.readFileSync(file, 'utf8')
    const d = deps(null)
    await expect(applyLimits('p7y-x', 'running', { memory: 2 * G }, d)).rejects.toThrow('cannot check its memory use right now: try again in a few seconds')
    expect(fs.readFileSync(file, 'utf8')).toBe(before)
  })

  it('leaves the compose file as it was when docker update fails', async () => {
    const before = fs.readFileSync(file, 'utf8')
    const d = deps(1 * G, vi.fn(async () => { throw new Error('Cannot update container: range of CPUs is from 0.01 to 2.00') }))
    await expect(applyLimits('p7y-x', 'running', { cpus: 3 }, d)).rejects.toThrow('range of CPUs')
    expect(fs.readFileSync(file, 'utf8')).toBe(before)
  })

  it('only writes the file for a deep-sleeping sandbox (no container to update)', async () => {
    const d = deps(null)
    await applyLimits('p7y-x', 'deep_sleep', { memory: 2 * G }, d)
    expect(fs.readFileSync(file, 'utf8')).toContain('mem_limit: 2048m')
    expect(d.update).not.toHaveBeenCalled()
  })
})
