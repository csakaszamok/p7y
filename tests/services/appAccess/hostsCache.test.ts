import { describe, it, expect, vi, beforeEach } from 'vitest'

const count = { dirs: 0, state: 0, links: 0, remembered: 0 }
vi.mock('../../../services/wake', () => ({ findSandboxDirByHost: vi.fn((h: string) => { count.dirs++; return h.startsWith('shop-') ? 'p7y-shop' : null }) }))
vi.mock('../../../services/sandboxPaths', () => ({ listSandboxDirs: vi.fn(() => { count.dirs++; return [{ name: 'p7y-shop', owner: 'bob@example.com', dir: '/x', legacy: false }] }) }))
vi.mock('../../../services/docker', () => ({ getSandboxState: vi.fn(async () => { count.state++; return { status: 'running' } }) }))
vi.mock('../../../services/appLinks', () => ({
  appLinks: vi.fn(async () => { count.links++; return [{ url: 'shop-own.example.com', port: 1, service: 'own', access: 'owner' }] }),
  rememberedApps: vi.fn(() => { count.remembered++; return null }),
}))

describe('accessOfHost: cached for a few seconds (every request of a non-public app asks)', () => {
  beforeEach(() => { for (const k of Object.keys(count) as (keyof typeof count)[]) count[k] = 0 })
  it('100 requests to the same app within 3 s: one look at the sandbox, not 100', async () => {
    const { accessOfHost, _resetHostCache } = await import('../../../services/appAccess/hosts')
    _resetHostCache()
    const t = { now: 1_000_000 }
    for (let i = 0; i < 100; i++) expect((await accessOfHost('shop-own.example.com', { now: () => t.now }))!.access).toBe('owner')
    expect(count.state).toBe(1)
    expect(count.dirs).toBe(2) // the sandbox of the host, and its owner: once each
    // After 3 s: looked at again
    t.now += 3_001
    await accessOfHost('shop-own.example.com', { now: () => t.now })
    expect(count.state).toBe(2)
  })
})
