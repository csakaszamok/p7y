import { describe, it, expect } from 'vitest'
import { uiHost, ownHostTaken } from '../../services/uiHost'

const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv

describe('uiHost', () => {
  it('is p9m.<HOST_DOMAIN> unless UI_HOST says otherwise', () => {
    expect(uiHost(env({}))).toBe('p9m.lvh.me')
    expect(uiHost(env({ HOST_DOMAIN: 'Example.com' }))).toBe('p9m.example.com')
    expect(uiHost(env({ HOST_DOMAIN: 'p9m.dev', UI_HOST: ' Console.p9m.dev ' }))).toBe('console.p9m.dev')
    expect(uiHost(env({ HOST_DOMAIN: 'p9m.dev', UI_HOST: '' }))).toBe('p9m.p9m.dev')
  })
})

describe('ownHostTaken', () => {
  const e = env({ HOST_DOMAIN: 'p9m.dev', UI_HOST: 'console-admin.p9m.dev', HUB_HOST: 'team-hub.p9m.dev' })
  it("names Purgatorium's address a sandbox's router (<raw>-*.<domain>) would answer for", () => {
    expect(ownHostTaken('console', e)).toBe('console-admin.p9m.dev')
    expect(ownHostTaken('team', e)).toBe('team-hub.p9m.dev')
  })
  it('null with an APPS_DOMAIN of its own: the sandbox routers answer only under it', () => {
    expect(ownHostTaken('console', env({ HOST_DOMAIN: 'p9m.dev', APPS_DOMAIN: 'p9m.app', UI_HOST: 'console-admin.p9m.dev' }))).toBeNull()
    expect(ownHostTaken('console', env({ HOST_DOMAIN: 'p9m.dev', APPS_DOMAIN: 'p9m.dev', UI_HOST: 'console-admin.p9m.dev' }))).toBe('console-admin.p9m.dev')
  })
  it('null for every other name, and for the default addresses (no dash)', () => {
    expect(ownHostTaken('console-admin', e)).toBeNull()
    expect(ownHostTaken('consol', e)).toBeNull()
    expect(ownHostTaken('shop', e)).toBeNull()
    expect(ownHostTaken('p9m', env({ HOST_DOMAIN: 'p9m.dev' }))).toBeNull()
    expect(ownHostTaken('registry', env({}))).toBeNull()
  })
  it('a UI_HOST outside HOST_DOMAIN is no sandbox address', () => {
    expect(ownHostTaken('console', env({ HOST_DOMAIN: 'p9m.dev', UI_HOST: 'console-admin.example.org' }))).toBeNull()
  })
})
