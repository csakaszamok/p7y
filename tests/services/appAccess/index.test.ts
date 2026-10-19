import { describe, it, expect, vi, beforeEach } from 'vitest'

// Counts every look at the disk or Docker a request could make
const count = { dirs: 0, state: 0, access: 0, fresh: 0 }
vi.mock('../../../services/wake', () => ({ findSandboxDirByHost: vi.fn(() => { count.dirs++; return 'p7y-new' }) }))
vi.mock('../../../services/sandboxPaths', () => ({ listSandboxDirs: vi.fn(() => { count.dirs++; return [{ name: 'p7y-new', owner: 'new@example.com', dir: '/x', legacy: false }] }) }))
vi.mock('../../../services/docker', () => ({ getSandboxState: vi.fn(async () => { count.state++; return { status: 'running' } }) }))
vi.mock('../../../services/appLinks', () => ({
  rememberedAccess: vi.fn(() => { count.access++; return { 'new-web': 'public' } }),
  freshAccess: vi.fn(async () => { count.fresh++; return { 'new-web': 'public' } }),
}))

const env = { HOST_DOMAIN: 'example.com' } as NodeJS.ProcessEnv
const shop = { 'shop-web': 'public' as const, 'shop-own': 'owner' as const }
const zero = () => { for (const k of Object.keys(count) as (keyof typeof count)[]) count[k] = 0 }

describe('the in-memory access index', () => {
  beforeEach(async () => {
    const { _resetHostCache } = await import('../../../services/appAccess/hosts')
    _resetHostCache()
  })
  it('a request for an indexed address reads nothing: no sandbox directories, no Docker, no files', async () => {
    const { rebuildIndex } = await import('../../../services/appAccess/index')
    const { accessOfHost } = await import('../../../services/appAccess/hosts')
    rebuildIndex({ sandboxes: [{ name: 'p7y-shop', owner: 'bob@example.com' }], accessOf: () => shop, env })
    zero()
    for (let i = 0; i < 200; i++) expect(await accessOfHost('shop-own.example.com')).toEqual({ sandbox: 'p7y-shop', owner: 'bob@example.com', access: 'owner' })
    expect(await accessOfHost('SHOP-WEB.example.com:443')).toMatchObject({ access: 'public' })
    expect(count).toEqual({ dirs: 0, state: 0, access: 0, fresh: 0 })
  })
  it('an address not in the index (a sandbox just created): looked up, then kept a few seconds', async () => {
    const { rebuildIndex } = await import('../../../services/appAccess/index')
    const { accessOfHost } = await import('../../../services/appAccess/hosts')
    rebuildIndex({ sandboxes: [], accessOf: () => null, env })
    zero()
    expect((await accessOfHost('new-web.example.com'))!.access).toBe('public')
    await accessOfHost('new-web.example.com')
    expect(count.access).toBe(1)
  })
})
