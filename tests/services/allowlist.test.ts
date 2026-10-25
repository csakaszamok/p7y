import { describe, it, expect } from 'vitest'
import { signInAllowed, subAllowed, openSignInWarning, hubAllowed, viewerOnly, purgatoriumSignInRefusal } from '../../services/allowlist'

const env = (over: Record<string, string>) => ({ ...over }) as NodeJS.ProcessEnv

describe('who may sign in', () => {
  it('without a list: anyone the provider lets through (as before)', () => {
    expect(signInAllowed('anyone@gmail.com', env({}))).toBe(true)
  })

  it('OIDC_ALLOWED_DOMAINS: the exact domain, any case; not a subdomain or a look-alike', () => {
    const e = env({ OIDC_ALLOWED_DOMAINS: ' Example.com, @partner.org ' })
    expect(signInAllowed('alice@example.com', e)).toBe(true)
    expect(signInAllowed('Bob@EXAMPLE.COM', e)).toBe(true)
    expect(signInAllowed('carol@partner.org', e)).toBe(true)
    expect(signInAllowed('dave@sub.example.com', e)).toBe(false)
    expect(signInAllowed('eve@example.com.evil.io', e)).toBe(false)
    expect(signInAllowed('mallory@gmail.com', e)).toBe(false)
  })

  it('OIDC_ALLOWED_EMAILS: single addresses, also next to the domains', () => {
    const e = env({ OIDC_ALLOWED_DOMAINS: 'example.com', OIDC_ALLOWED_EMAILS: 'Guest@Gmail.com' })
    expect(signInAllowed('guest@gmail.com', e)).toBe(true)
    expect(signInAllowed('alice@example.com', e)).toBe(true)
    expect(signInAllowed('other@gmail.com', e)).toBe(false)
  })

  it('the local admin is never on a list', () => {
    const e = env({ OIDC_ALLOWED_DOMAINS: 'example.com' })
    expect(subAllowed('admin', 'admin', e)).toBe(true)
    expect(subAllowed('admin', 'user', e)).toBe(true) // a token the admin minted for itself
    expect(subAllowed('x@gmail.com', 'user', e)).toBe(false)
  })

  it('warns when OIDC lets anyone in', () => {
    const oidc = { OIDC_ISSUER: 'https://accounts.google.com', OIDC_CLIENT_ID: 'c', OIDC_CLIENT_SECRET: 's' }
    expect(openSignInWarning(env(oidc))).toMatch(/anyone/)
    expect(openSignInWarning(env({ ...oidc, OIDC_ALLOWED_EMAILS: 'a@b.c' }))).toBeNull()
    expect(openSignInWarning(env({}))).toBeNull()
  })
})


describe('hubAllowed / viewerOnly', () => {
  const e = env({ OIDC_ALLOWED_EMAILS: 'anna@example.com', HUB_ALLOWED_DOMAINS: 'example.com' })
  it('lets builders and Hub-list accounts onto the Hub', () => {
    expect(hubAllowed('anna@example.com', e)).toBe(true)
    expect(hubAllowed('peter@example.com', e)).toBe(true)
    expect(hubAllowed('eve@other.org', e)).toBe(false)
  })
  it('a viewer is on the Hub list only', () => {
    expect(viewerOnly('peter@example.com', e)).toBe(true)
    expect(viewerOnly('anna@example.com', e)).toBe(false)
    expect(viewerOnly('eve@other.org', e)).toBe(false)
  })
  it('without Hub lists only builders use the Hub', () => {
    const b = env({ OIDC_ALLOWED_EMAILS: 'anna@example.com' })
    expect(hubAllowed('anna@example.com', b)).toBe(true)
    expect(hubAllowed('peter@example.com', b)).toBe(false)
  })
  it('open sign-in (no builder lists) stays open on the Hub too', () => {
    expect(hubAllowed('anyone@anywhere.org', env({}))).toBe(true)
  })
})

describe('purgatoriumSignInRefusal', () => {
  it('lets builders in', () => {
    expect(purgatoriumSignInRefusal('anna@example.com', env({ OIDC_ALLOWED_EMAILS: 'anna@example.com' }))).toBeNull()
  })
  it('points a viewer to the Hub when it is on', () => {
    const e = env({ OIDC_ALLOWED_EMAILS: 'anna@example.com', HUB_ALLOWED_DOMAINS: 'example.com', HUB_ENABLED: 'true', HOST_DOMAIN: 'example.com', PUBLIC_URL: 'https://p9m.example.com' })
    expect(purgatoriumSignInRefusal('peter@example.com', e)).toBe('You have access to the Hub only: https://hub.example.com')
  })
  it('refuses others as before', () => {
    expect(purgatoriumSignInRefusal('eve@other.org', env({ OIDC_ALLOWED_EMAILS: 'anna@example.com' })))
      .toBe('Your account (eve@other.org) may not sign in here. Ask the administrator.')
  })
})
