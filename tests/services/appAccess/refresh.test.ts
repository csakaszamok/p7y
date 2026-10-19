import { describe, it, expect, vi } from 'vitest'

const calls: string[] = []
vi.mock('../../../services/appLinks', () => ({
  appLinks: vi.fn(async (n: string) => { calls.push(`read ${n}`); return [] }),
  forgetAppLinks: vi.fn((n: string) => { calls.push(`forget ${n}`) }),
  rememberedApps: vi.fn(() => null),
  rememberedAccess: vi.fn(() => null),
  freshAccess: vi.fn(async () => null),
}))
vi.mock('../../../services/docker', () => ({ listManagedContainers: vi.fn(async () => [{ name: 'p7y-a', status: 'running' }, { name: 'p7y-b', status: 'exited' }]) }))

describe('refreshRunningLinks', () => {
  // Review Focus 1: not the 10 s cached answer, or a new label could wait ~20 s instead of ~10
  it('reads every running sandbox afresh, past the 10 s cache of the app links', async () => {
    const { refreshRunningLinks } = await import('../../../services/appAccess/traefik')
    await refreshRunningLinks()
    expect(calls).toEqual(['forget p7y-a', 'read p7y-a'])
  })
})
