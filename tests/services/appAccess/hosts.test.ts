import { describe, it, expect } from 'vitest'
import { accessOfHost, sandboxAccess } from '../../../services/appAccess/hosts'

const links = [
  { url: 'shop-web.example.com', port: 8080, service: 'web', access: 'domain' as const },
  { url: 'shop-doc.example.com', port: 9001, service: 'doc', access: 'public' as const },
]
const deps = {
  sandboxOf: (h: string) => h.startsWith('shop-') ? 'p7y-shop' : null,
  ownerOf: () => 'bob@example.com',
  links: async () => links,
  env: {} as NodeJS.ProcessEnv,
}

describe('accessOfHost', () => {
  it('an app host: its own level and the sandbox owner', async () => {
    expect(await accessOfHost('shop-web.example.com', deps)).toEqual({ sandbox: 'p7y-shop', owner: 'bob@example.com', access: 'domain' })
    expect(await accessOfHost('SHOP-DOC.example.com:443', deps)).toEqual({ sandbox: 'p7y-shop', owner: 'bob@example.com', access: 'public' })
  })
  it('a host of the sandbox without a known app: the most restrictive of its apps (closed)', async () => {
    expect((await accessOfHost('shop-new.example.com', deps))!.access).toBe('domain')
  })
  it('no links known at all: the default', async () => {
    expect((await accessOfHost('shop-x.example.com', { ...deps, links: async () => null, env: { APPS_ACCESS_DEFAULT: 'owner' } as NodeJS.ProcessEnv }))!.access).toBe('owner')
  })
  it('not a sandbox host: null', async () => {
    expect(await accessOfHost('p7y.example.com', deps)).toBeNull()
  })
  it('sandboxAccess: the most restrictive of its links', () => {
    expect(sandboxAccess('p7y-shop', links, {} as NodeJS.ProcessEnv)).toBe('domain')
    expect(sandboxAccess('p7y-shop', [], { APPS_ACCESS_DEFAULT: 'domain' } as NodeJS.ProcessEnv)).toBe('domain')
  })
})
