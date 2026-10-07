import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('SESSION_SECRET', 'test-secret')
vi.stubEnv('PUBLIC_URL', 'http://p7y.lvh.me')

import { createSession, readSession, signValue, verifyValue, getCookie, cookieHeader, publicUrl, SESSION_MAX_AGE } from '../../services/session'

describe('session cookie', () => {
  it('round-trips a session until it expires', () => {
    const now = Date.UTC(2026, 8, 27)
    const v = createSession('alice@example.com', 'user', now)
    expect(readSession(v, now)).toEqual({ sub: 'alice@example.com', role: 'user', exp: now / 1000 + SESSION_MAX_AGE })
    expect(readSession(v, now + SESSION_MAX_AGE * 1000 + 1000)).toBeNull()
  })

  it('rejects tampered, foreign-key and malformed values', () => {
    const v = createSession('alice@example.com', 'user')
    const [data, sig] = v.split('.')
    const forged = Buffer.from(JSON.stringify({ sub: 'alice@example.com', role: 'admin', exp: 9e9 })).toString('base64url')
    expect(readSession(`${forged}.${sig}`)).toBeNull()
    expect(readSession(`${data}.${sig.slice(0, -2)}xx`)).toBeNull()
    expect(readSession('garbage')).toBeNull()
    expect(readSession(undefined)).toBeNull()
    expect(readSession(signValue({ sub: 'x', role: 'root', exp: 9e9 }))).toBeNull()
  })

  it('verifies arbitrary signed payloads', () => {
    expect(verifyValue<{ a: number }>(signValue({ a: 1 }))).toEqual({ a: 1 })
  })
})

describe('cookie helpers', () => {
  it('reads a cookie by name', () => {
    const req = new Request('http://x/', { headers: { cookie: 'a=1; p7y_session=abc.def; b=2' } })
    expect(getCookie(req, 'p7y_session')).toBe('abc.def')
    expect(getCookie(req, 'missing')).toBeUndefined()
  })

  it('builds HttpOnly Lax cookies, Secure only on https', () => {
    expect(cookieHeader('n', 'v', 60)).toBe('n=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=60')
    vi.stubEnv('PUBLIC_URL', 'https://p7y.example.com/')
    expect(cookieHeader('n', 'v', 0)).toBe('n=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure')
    expect(publicUrl()).toBe('https://p7y.example.com')
    vi.stubEnv('PUBLIC_URL', 'http://p7y.lvh.me')
  })
})
