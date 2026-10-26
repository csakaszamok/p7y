import { describe, it, expect, vi, beforeEach } from 'vitest'

let installed = ['runc']
vi.mock('../../services/docker', () => ({ dockerRuntimes: vi.fn(async () => installed) }))
const { defaultRuntime, runtimeMissing, runtimeAllowed, allowedRuntimes, _resetDefaultRuntime } = await import('../../services/defaultRuntime')

beforeEach(() => { _resetDefaultRuntime(); installed = ['runc'] })

describe('defaultRuntime', () => {
  it('auto (the default): sysbox where the host has sysbox-runc, dind otherwise when allowed', async () => {
    expect(await defaultRuntime({ ALLOWED_RUNTIMES: 'all' })).toBe('dind')
    // dind not allowed (the default): sysbox, so a create says sysbox is missing
    expect(await defaultRuntime({})).toBe('sysbox')
    _resetDefaultRuntime(); installed = ['runc', 'sysbox-runc']
    expect(await defaultRuntime({ DEFAULT_RUNTIME: 'auto' })).toBe('sysbox')
  })
  it('a runtime named in DEFAULT_RUNTIME is kept as it is', async () => {
    expect(await defaultRuntime({ DEFAULT_RUNTIME: 'dind' })).toBe('dind')
    expect(await defaultRuntime({ DEFAULT_RUNTIME: 'sysbox' })).toBe('sysbox')
  })
})

describe('runtimeMissing', () => {
  it('sysbox without sysbox-runc on the host says so; dind always runs', async () => {
    expect(await runtimeMissing('sysbox')).toMatch(/sysbox is not installed on this host/)
    expect(await runtimeMissing('dind')).toBeNull()
    _resetDefaultRuntime(); installed = ['runc', 'sysbox-runc']
    expect(await runtimeMissing('sysbox')).toBeNull()
  })
})

describe('ALLOWED_RUNTIMES', () => {
  it('empty or unset: sysbox only (dind is for development); all: every runtime', () => {
    expect(allowedRuntimes({})).toEqual(['sysbox'])
    expect(allowedRuntimes({ ALLOWED_RUNTIMES: ' , ' })).toEqual(['sysbox'])
    expect(runtimeAllowed('dind', {})).toBe(false)
    expect(runtimeAllowed('sysbox', {})).toBe(true)
    expect(allowedRuntimes({ ALLOWED_RUNTIMES: 'All' })).toBeNull()
    expect(runtimeAllowed('dind', { ALLOWED_RUNTIMES: 'all' })).toBe(true)
  })
  it('a comma list (spaces and case ignored) allows only those', () => {
    const env = { ALLOWED_RUNTIMES: ' Sysbox, kata ' }
    expect(allowedRuntimes(env)).toEqual(['sysbox', 'kata'])
    expect(runtimeAllowed('sysbox', env)).toBe(true)
    expect(runtimeAllowed('dind', env)).toBe(false)
  })
})
