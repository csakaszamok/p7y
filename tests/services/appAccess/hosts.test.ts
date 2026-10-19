import { describe, it, expect } from 'vitest'
import { accessOfHost, sandboxAccess } from '../../../services/appAccess/hosts'

// Each app's level by its link name (the first label of its address), as read from the containers' labels
const map = { 'shop-web': 'public' as const, 'shop-dom': 'domain' as const }
const deps = (over: Record<string, unknown> = {}) => ({
  sandboxOf: (h: string) => h.startsWith('shop-') ? 'p7y-shop' : null,
  ownerOf: () => 'bob@example.com',
  accessMap: () => map,
  fresh: async () => null,
  env: {} as NodeJS.ProcessEnv,
  ...over,
})

describe('accessOfHost', () => {
  it('an app host: its own level and the sandbox owner', async () => {
    expect(await accessOfHost('shop-dom.example.com', deps())).toEqual({ sandbox: 'p7y-shop', owner: 'bob@example.com', access: 'domain' })
    expect(await accessOfHost('SHOP-WEB.example.com:443', deps())).toEqual({ sandbox: 'p7y-shop', owner: 'bob@example.com', access: 'public' })
  })
  it('an address of the sandbox whose app is not known: read the labels afresh', async () => {
    expect((await accessOfHost('shop-own.example.com', deps({ fresh: async () => ({ ...map, 'shop-own': 'owner' }) })))!.access).toBe('owner')
    expect((await accessOfHost('shop-new.example.com', deps({ fresh: async () => ({ ...map, 'shop-new': 'public' }) })))!.access).toBe('public')
  })
  // The cause of a leak found by the load test: frps had registered the public app, not yet the owner one
  it('still not known: closed (owner), never the level of the other apps', async () => {
    expect((await accessOfHost('shop-own.example.com', deps({ fresh: async () => map })))!.access).toBe('owner')
    expect((await accessOfHost('shop-own.example.com', deps({ accessMap: () => null, fresh: async () => null })))!.access).toBe('owner')
  })
  it('not a sandbox host: null', async () => {
    expect(await accessOfHost('p7y.example.com', deps())).toBeNull()
  })
  it('sandboxAccess: the strictest of its apps; nothing known: null (unknown)', () => {
    expect(sandboxAccess(map)).toBe('domain')
    expect(sandboxAccess({ a: 'public' })).toBe('public')
    expect(sandboxAccess(null)).toBeNull()
    expect(sandboxAccess({})).toBeNull()
  })
})
