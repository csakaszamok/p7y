import { describe, it, expect, vi, beforeEach } from 'vitest'

let installed = ['runc']
vi.mock('../../services/docker', () => ({ dockerRuntimes: vi.fn(async () => installed) }))
const { defaultRuntime, runtimeMissing, _resetDefaultRuntime } = await import('../../services/defaultRuntime')

beforeEach(() => { _resetDefaultRuntime(); installed = ['runc'] })

describe('defaultRuntime', () => {
  it('auto (the default): sysbox where the host has sysbox-runc, dind otherwise', async () => {
    expect(await defaultRuntime({})).toBe('dind')
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
