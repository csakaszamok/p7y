import { describe, it, expect, beforeEach, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { decide, withoutAppCookie } from '../../../services/appAccess/decide'
import { issueTicket, appCookieValue, _resetSign } from '../../../services/appAccess/sign'

const bob = { sub: 'bob@example.com', role: 'user' as const }
const ann = { sub: 'ann@example.com', role: 'user' as const }
const levels: Record<string, 'public' | 'domain' | 'owner'> = { 'shop-pub.example.com': 'public', 'shop-dom.example.com': 'domain', 'shop-own.example.com': 'owner' }
const deps = { access: async (h: string) => levels[h] ? { sandbox: 'p7y-shop', owner: 'bob@example.com', access: levels[h] } : null, env: { HOST_DOMAIN: 'example.com' } as NodeJS.ProcessEnv }
const req = (host: string, uri = '/', cookie = '') => ({ host, proto: 'https', uri, cookie })

describe('/auth/app', () => {
  beforeEach(() => {
    vi.stubEnv('APP_ACCESS_KEY_FILE', path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'acc-')), 'k'))
    vi.stubEnv('HOST_DOMAIN', 'example.com')
    _resetSign()
  })
  it('public: 200, the request cookies echoed, X-P7y-User empty', async () => {
    const r = await decide(req('shop-pub.example.com', '/', 'theirs=1; other=2'), deps)
    expect(r).toEqual({ status: 200, headers: { Cookie: 'theirs=1; other=2', 'X-P7y-User': '' } })
  })
  it('not public, no cookie: to Purgatory, absolute, with the whole address', async () => {
    const r = await decide(req('shop-dom.example.com', '/a?b=1'), deps)
    expect(r.status).toBe(302)
    expect(r.headers.Location).toBe('https://p7y.example.com/auth/app/start?rd=' + encodeURIComponent('https://shop-dom.example.com/a?b=1'))
  })
  it('a ticket on its landing path: the cookie, and back to the page (absolute)', async () => {
    const t = issueTicket('shop-own.example.com', bob)
    const r = await decide(req('shop-own.example.com', `/__p7y/auth?ticket=${encodeURIComponent(t)}&rd=${encodeURIComponent('/x?y=1')}`), deps)
    expect(r.status).toBe(302)
    expect(r.headers.Location).toBe('https://shop-own.example.com/x?y=1')
    expect(r.headers['Set-Cookie']).toMatch(/^__p7y_app=.+; Path=\/; Max-Age=28800; HttpOnly; SameSite=Lax; Secure$/)
  })
  it('a landing rd that leaves the host is ignored (to /)', async () => {
    const t = issueTicket('shop-own.example.com', bob)
    const r = await decide(req('shop-own.example.com', `/__p7y/auth?ticket=${encodeURIComponent(t)}&rd=${encodeURIComponent('//evil.example/x')}`), deps)
    expect(r.headers.Location).toBe('https://shop-own.example.com/')
  })
  it('with the cookie: 200, the user, and the cookies without __p7y_app', async () => {
    const c = appCookieValue('shop-own.example.com', bob)
    for (const cookie of [`__p7y_app=${c}; theirs=1`, `theirs=1; __p7y_app=${c}`, `a=1; __p7y_app=${c}; b=2`]) {
      const r = await decide(req('shop-own.example.com', '/', cookie), deps)
      expect(r.status).toBe(200)
      expect(r.headers['X-P7y-User']).toBe('bob@example.com')
      expect(r.headers.Cookie).not.toContain('__p7y_app')
    }
  })
  it('a cookie of another user for an owner app: to Purgatory, which shows the refusal (and issues no ticket: no loop)', async () => {
    const c = appCookieValue('shop-own.example.com', ann)
    const r = await decide(req('shop-own.example.com', '/', `__p7y_app=${c}`), deps)
    expect(r.status).toBe(302)
    expect(r.headers.Location).toContain('/auth/app/start?rd=')
  })
  it('a host that is no sandbox app: 404', async () => {
    expect((await decide(req('nope.example.com'), deps)).status).toBe(404)
  })
  // A sibling app can set a junk __p7y_app for the whole domain, sent before the real one: not a lockout
  it('a junk __p7y_app before the real one does not shadow it', async () => {
    const c = appCookieValue('shop-own.example.com', bob)
    const r = await decide(req('shop-own.example.com', '/', `__p7y_app=junk; __p7y_app=${c}; theirs=1`), deps)
    expect(r.status).toBe(200)
    expect(r.headers['X-P7y-User']).toBe('bob@example.com')
  })
  it('withoutAppCookie', () => {
    expect(withoutAppCookie('__p7y_app=x')).toBe('')
    expect(withoutAppCookie('a=1;__p7y_app=x;  b=2')).toBe('a=1; b=2')
  })
})
