import { describe, it, expect, vi, beforeEach } from 'vitest'

const count = { dirs: 0, state: 0, access: 0, fresh: 0 }
vi.mock('../../../services/wake', () => ({ findSandboxDirByHost: vi.fn((h: string) => { count.dirs++; return h.startsWith('shop-') ? 'p9m-shop' : null }) }))
vi.mock('../../../services/sandboxPaths', () => ({ listSandboxDirs: vi.fn(() => { count.dirs++; return [{ name: 'p9m-shop', owner: 'bob@example.com', dir: '/x', legacy: false }] }) }))
vi.mock('../../../services/docker', () => ({ getSandboxState: vi.fn(async () => { count.state++; return { status: 'running' } }) }))
vi.mock('../../../services/appLinks', () => ({
  rememberedAccess: vi.fn(() => { count.access++; return { 'shop-own': 'owner' } }),
  freshAccess: vi.fn(async () => { count.fresh++; return { 'shop-own': 'owner' } }),
}))

describe('accessOfHost: cached for a few seconds (every request of a non-public app asks)', () => {
  beforeEach(() => { for (const k of Object.keys(count) as (keyof typeof count)[]) count[k] = 0 })
  it('100 requests to the same app within 3 s: one look, not 100', async () => {
    const { accessOfHost, _resetHostCache } = await import('../../../services/appAccess/hosts')
    _resetHostCache()
    const t = { now: 1_000_000 }
    for (let i = 0; i < 100; i++) expect((await accessOfHost('shop-own.example.com', { now: () => t.now }))!.access).toBe('owner')
    expect(count.access).toBe(1)
    expect(count.dirs).toBe(2) // the sandbox of the host, and its owner: once each
    t.now += 3_001
    await accessOfHost('shop-own.example.com', { now: () => t.now })
    expect(count.access).toBe(2)
  })
  it('an unknown address of a running sandbox reads its labels afresh, at most every 2 s', async () => {
    const { accessOfHost, _resetHostCache } = await import('../../../services/appAccess/hosts')
    _resetHostCache()
    const t = { now: 2_000_000 }
    for (const h of ['shop-a.example.com', 'shop-b.example.com', 'shop-c.example.com']) expect((await accessOfHost(h, { now: () => t.now }))!.access).toBe('owner')
    expect(count.fresh).toBe(1)
  })
})
