import { describe, it, expect } from 'vitest'
import { hostDomain, appsDomain } from '../../services/domains'

const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv

describe('hostDomain / appsDomain', () => {
  it('the apps are under HOST_DOMAIN unless APPS_DOMAIN says otherwise', () => {
    expect(hostDomain(env({}))).toBe('lvh.me')
    expect(appsDomain(env({}))).toBe('lvh.me')
    expect(appsDomain(env({ HOST_DOMAIN: 'P9m.dev' }))).toBe('p9m.dev')
    expect(appsDomain(env({ HOST_DOMAIN: 'p9m.dev', APPS_DOMAIN: '' }))).toBe('p9m.dev') // APPS_DOMAIN= in .env
    expect(appsDomain(env({ HOST_DOMAIN: 'p9m.dev', APPS_DOMAIN: ' P9m.App ' }))).toBe('p9m.app')
    expect(hostDomain(env({ HOST_DOMAIN: 'p9m.dev', APPS_DOMAIN: 'p9m.app' }))).toBe('p9m.dev')
  })
})
