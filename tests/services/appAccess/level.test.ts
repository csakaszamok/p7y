import { describe, it, expect } from 'vitest'
import { accessDefault, accessOfLabel, mostRestrictive, mayOpen } from '../../../services/appAccess/level'

const env = (o: Record<string, string> = {}) => ({ ...o }) as NodeJS.ProcessEnv

describe('access levels', () => {
  it('the default is owner, or APPS_ACCESS_DEFAULT when valid', () => {
    expect(accessDefault(env())).toBe('owner')
    expect(accessDefault(env({ APPS_ACCESS_DEFAULT: 'public' }))).toBe('public')
    expect(accessDefault(env({ APPS_ACCESS_DEFAULT: 'domain' }))).toBe('domain')
    expect(accessDefault(env({ APPS_ACCESS_DEFAULT: 'Owner' }))).toBe('owner')
    // An unknown default is the closed one, not public
    expect(accessDefault(env({ APPS_ACCESS_DEFAULT: 'team' }))).toBe('owner')
  })
  it('a label: its level; none: the default; anything else: owner, marked invalid', () => {
    expect(accessOfLabel('public', env())).toEqual({ access: 'public', invalid: false })
    expect(accessOfLabel(' Domain ', env())).toEqual({ access: 'domain', invalid: false })
    expect(accessOfLabel(undefined, env({ APPS_ACCESS_DEFAULT: 'domain' }))).toEqual({ access: 'domain', invalid: false })
    expect(accessOfLabel('', env())).toEqual({ access: 'owner', invalid: false })
    expect(accessOfLabel('privat', env())).toEqual({ access: 'owner', invalid: true })
  })
  it('the most restrictive of several; none: the default', () => {
    expect(mostRestrictive(['public', 'domain'], env())).toBe('domain')
    expect(mostRestrictive(['domain', 'owner', 'public'], env())).toBe('owner')
    expect(mostRestrictive([], env({ APPS_ACCESS_DEFAULT: 'domain' }))).toBe('domain')
  })
  it('who may open', () => {
    const u = { sub: 'ann@example.com', role: 'user' as const }
    const admin = { sub: 'admin', role: 'admin' as const }
    expect(mayOpen('public', null, 'bob@example.com', env())).toBe(true)
    expect(mayOpen('domain', null, 'bob@example.com', env())).toBe(false)
    expect(mayOpen('domain', u, 'bob@example.com', env())).toBe(true)
    expect(mayOpen('domain', u, 'bob@example.com', env({ OIDC_ALLOWED_DOMAINS: 'other.org' }))).toBe(false)
    expect(mayOpen('owner', u, 'bob@example.com', env())).toBe(false)
    expect(mayOpen('owner', { sub: 'Bob@Example.com', role: 'user' }, 'bob@example.com', env())).toBe(true)
    expect(mayOpen('owner', admin, 'bob@example.com', env())).toBe(true)
  })
})
