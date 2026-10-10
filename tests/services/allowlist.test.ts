import { describe, it, expect } from 'vitest'
import { signInAllowed, subAllowed, openSignInWarning } from '../../services/allowlist'

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
