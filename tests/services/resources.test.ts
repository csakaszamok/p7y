import { describe, it, expect } from 'vitest'
import { parseCpus, parseMemory, memoryForCompose, formatBytes, resourceDefaults, checkLimits, readLimits, withLimits } from '../../services/resources'

const G = 1024 ** 3
const M = 1024 ** 2

describe('parsing', () => {
  it('reads CPUs as a number or a string, up to 2 decimals', () => {
    expect(parseCpus(1.5)).toBe(1.5)
    expect(parseCpus('0.5')).toBe(0.5)
    for (const bad of [0, -1, '1.234', 'two', '', null, {}]) expect(parseCpus(bad), JSON.stringify(bad)).toBeNull()
  })

  it('reads memory with k/m/g, any case, decimals allowed', () => {
    expect(parseMemory('4g')).toBe(4 * G)
    expect(parseMemory('4G')).toBe(4 * G)
    expect(parseMemory('1.5g')).toBe(parseMemory('1536m'))
    expect(parseMemory('512m')).toBe(512 * M)
    expect(parseMemory('65536k')).toBe(64 * M)
    for (const bad of ['4', '4gb', 'lots', '', 7, '-1g']) expect(parseMemory(bad), JSON.stringify(bad)).toBeNull()
  })

  it('writes memory for compose in whole MiB and formats it for people', () => {
    expect(memoryForCompose(1.5 * G)).toBe('1536m')
    expect(formatBytes(8 * G)).toBe('8 GB')
    expect(formatBytes(1.2 * G)).toBe('1.2 GB')
    expect(formatBytes(512 * M)).toBe('512 MB')
  })
})

describe('resourceDefaults', () => {
  it('uses the env, falling back with a warning on nonsense', () => {
    expect(resourceDefaults({})).toEqual({ limits: { cpus: 2, memory: 4 * G }, ceiling: { cpus: 4, memory: 8 * G }, warnings: [] })
    const d = resourceDefaults({ SANDBOX_CPUS: '1', SANDBOX_MEMORY: 'big', SANDBOX_MAX_CPUS: '8', SANDBOX_MAX_MEMORY: '16g' })
    expect(d.limits).toEqual({ cpus: 1, memory: 4 * G })
    expect(d.ceiling).toEqual({ cpus: 8, memory: 16 * G })
    expect(d.warnings).toEqual(['SANDBOX_MEMORY=big is not a memory size like 4g: using 4g'])
  })
})

describe('checkLimits', () => {
  const ctx = { ceiling: { cpus: 4, memory: 8 * G }, host: { cpus: 20, memory: 32 * G } }

  it('lets a user go up to the ceiling, not over it', () => {
    expect(checkLimits({ cpus: 4, memory: '8g' }, 'user', ctx)).toEqual({ ok: true, cpus: 4, memory: 8 * G })
    expect(checkLimits({ cpus: 5 }, 'user', ctx)).toEqual({ ok: false, status: 403, error: 'at most 4 CPUs for a sandbox: ask the administrator for more' })
    expect(checkLimits({ memory: '9g' }, 'user', ctx)).toEqual({ ok: false, status: 403, error: 'at most 8 GB memory for a sandbox: ask the administrator for more' })
  })

  it('lets the admin go over the ceiling up to the host', () => {
    expect(checkLimits({ cpus: 16, memory: '24g' }, 'admin', ctx)).toEqual({ ok: true, cpus: 16, memory: 24 * G })
    expect(checkLimits({ cpus: 21 }, 'admin', ctx)).toEqual({ ok: false, status: 400, error: 'cpus must be a number between 0.1 and 20' })
    expect(checkLimits({ memory: '33g' }, 'admin', ctx)).toEqual({ ok: false, status: 400, error: 'memory can be at most 32 GB' })
  })

  it('caps a user at the host when the host is smaller than the ceiling', () => {
    const small = { ceiling: { cpus: 4, memory: 8 * G }, host: { cpus: 2, memory: 4 * G } }
    expect(checkLimits({ cpus: 3 }, 'user', small)).toEqual({ ok: false, status: 403, error: 'at most 2 CPUs for a sandbox: ask the administrator for more' })
    expect(checkLimits({ memory: '6g' }, 'user', small)).toEqual({ ok: false, status: 403, error: 'at most 4 GB memory for a sandbox: ask the administrator for more' })
  })

  it('names a malformed value, and passes through what is not given', () => {
    expect(checkLimits({ cpus: 'x' }, 'user', ctx)).toEqual({ ok: false, status: 400, error: 'cpus must be a number between 0.1 and 4' })
    expect(checkLimits({ memory: '10m' }, 'user', ctx)).toEqual({ ok: false, status: 400, error: 'memory must look like 512m or 4g, at least 64m' })
    expect(checkLimits({}, 'user', ctx)).toEqual({ ok: true })
  })
})

describe('compose limits', () => {
  const compose = 'services:\n  sandbox:\n    image: x\n  frps:\n    image: y\n'

  it('reads none from a compose file without them', () => {
    expect(readLimits(compose)).toBeNull()
    expect(readLimits('not: [yaml')).toBeNull()
  })

  it('writes cpus, mem_limit and memswap_limit on the sandbox service only, and reads them back', () => {
    const out = withLimits(compose, { cpus: 1.5, memory: 2 * G })
    expect(out).toContain('cpus: 1.5')
    expect(out).toContain('mem_limit: 2048m')
    expect(out).toContain('memswap_limit: 2048m')
    expect(readLimits(out)).toEqual({ cpus: 1.5, memory: 2 * G })
    expect(out.split('frps:')[1]).not.toContain('mem_limit')
  })
})
