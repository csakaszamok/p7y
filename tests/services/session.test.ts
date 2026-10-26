import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('SESSION_SECRET', 'test-secret')
vi.stubEnv('PUBLIC_URL', 'http://p9m.lvh.me')

import { createSession, readSession, signValue, verifyValue, getCookie, cookieHeader, publicUrl, SESSION_MAX_AGE, idleTimeout, idleLeft, touchedSessionCookie } from '../../services/session'

describe('signed out for doing nothing (SESSION_IDLE_TIMEOUT)', () => {
  const now = Date.UTC(2026, 9, 26, 12)
  const MIN = 60_000

  it('30 minutes by default; another duration, or off', () => {
    expect(idleTimeout({})).toBe(30 * 60)
    expect(idleTimeout({ SESSION_IDLE_TIMEOUT: '2h' })).toBe(7200)
    expect(idleTimeout({ SESSION_IDLE_TIMEOUT: 'off' })).toBeNull()
    expect(idleTimeout({ SESSION_IDLE_TIMEOUT: 'nonsense' })).toBe(30 * 60)
  })

  it('a session ends 30 minutes after its user last did something; doing something starts the time again', () => {
    const v = createSession('alice@example.com', 'user', now)
    expect(readSession(v, now + 29 * MIN, {})).not.toBeNull()
    expect(idleLeft(readSession(v, now + 29 * MIN, {})!, now + 29 * MIN, {})).toBe(60)
    expect(readSession(v, now + 30 * MIN, {})).toBeNull()
    // Active at minute 20: good until minute 50, still ending after 7 days at the latest
    const touched = touchedSessionCookie(v, now + 20 * MIN, {})!
    expect(touched).toMatch(/^p9m_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+/)
    const renewed = touched.split(';')[0].slice('p9m_session='.length)
    expect(readSession(renewed, now + 49 * MIN, {})).not.toBeNull()
    expect(readSession(renewed, now + 50 * MIN, {})).toBeNull()
    expect(readSession(renewed, now + 49 * MIN, {})!.exp).toBe(now / 1000 + SESSION_MAX_AGE)
    // An ended session cannot be renewed
    expect(touchedSessionCookie(v, now + 31 * MIN, {})).toBeNull()
  })

  it('a session made before this (no seen): as if last active when it was made', () => {
    const old = signValue({ sub: 'alice@example.com', role: 'user', exp: now / 1000 + SESSION_MAX_AGE })
    expect(readSession(old, now + 10 * MIN, {})).not.toBeNull()
    expect(readSession(old, now + 31 * MIN, {})).toBeNull()
  })
})

describe('session cookie', () => {
  it('round-trips a session until it expires', () => {
    const now = Date.UTC(2026, 8, 27)
    const v = createSession('alice@example.com', 'user', now)
    expect(readSession(v, now)).toEqual({ sub: 'alice@example.com', role: 'user', exp: now / 1000 + SESSION_MAX_AGE, seen: now / 1000 })
    const noIdle = { SESSION_IDLE_TIMEOUT: 'off' }
    expect(readSession(v, now + (SESSION_MAX_AGE - 1) * 1000, noIdle)).not.toBeNull()
    expect(readSession(v, now + SESSION_MAX_AGE * 1000 + 1000, noIdle)).toBeNull()
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
    const req = new Request('http://x/', { headers: { cookie: 'a=1; p9m_session=abc.def; b=2' } })
    expect(getCookie(req, 'p9m_session')).toBe('abc.def')
    expect(getCookie(req, 'missing')).toBeUndefined()
  })

  it('builds HttpOnly Lax cookies, Secure only on https', () => {
    expect(cookieHeader('n', 'v', 60)).toBe('n=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=60')
    vi.stubEnv('PUBLIC_URL', 'https://p9m.example.com/')
    expect(cookieHeader('n', 'v', 0)).toBe('n=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure')
    expect(publicUrl()).toBe('https://p9m.example.com')
    vi.stubEnv('PUBLIC_URL', 'http://p9m.lvh.me')
  })
})
