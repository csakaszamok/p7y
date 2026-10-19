import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { issueTicket, redeemTicket, appCookieValue, readAppCookie, appCookieHeader, _resetSign, APP_COOKIE } from '../../../services/appAccess/sign'

const ann = { sub: 'ann@example.com', role: 'user' as const }
const T = Date.parse('2026-10-20T10:00:00Z')

describe('tickets and the app cookie', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'access-'))
    vi.stubEnv('APP_ACCESS_SECRET', '')
    vi.stubEnv('APP_ACCESS_KEY_FILE', path.join(dir, 'app-access.key'))
    _resetSign()
  })
  it('a ticket works once, for its host, within 60 s', () => {
    const t = issueTicket('shop-web.example.com', ann, T)
    expect(redeemTicket(t, 'other-web.example.com', T)).toBeNull()
    expect(redeemTicket(t, 'shop-web.example.com', T + 61_000)).toBeNull()
    const t2 = issueTicket('shop-web.example.com', ann, T)
    expect(redeemTicket(t2, 'shop-web.example.com', T + 1000)).toEqual(ann)
    expect(redeemTicket(t2, 'shop-web.example.com', T + 2000)).toBeNull()
  })
  it('the cookie is for its host only and lasts 8 h', () => {
    const c = appCookieValue('shop-web.example.com', ann, T)
    expect(readAppCookie(c, 'shop-web.example.com', T + 3600_000)).toEqual(ann)
    expect(readAppCookie(c, 'shop-api.example.com', T)).toBeNull()
    expect(readAppCookie(c, 'shop-web.example.com', T + 8 * 3600_000 + 1000)).toBeNull()
    expect(readAppCookie(c + 'x', 'shop-web.example.com', T)).toBeNull()
  })
  it('a ticket is not a cookie and a cookie is not a ticket', () => {
    const t = issueTicket('h.example.com', ann, T)
    expect(readAppCookie(t, 'h.example.com', T)).toBeNull()
    expect(redeemTicket(appCookieValue('h.example.com', ann, T), 'h.example.com', T)).toBeNull()
  })
  it('the generated key is kept in its file and used again after a restart', () => {
    const c = appCookieValue('h.example.com', ann, T)
    expect(fs.existsSync(path.join(dir, 'app-access.key'))).toBe(true)
    _resetSign()
    expect(readAppCookie(c, 'h.example.com', T)).toEqual(ann)
  })
  it('the cookie header: host-only, HttpOnly, Lax, Secure on https, 8 h', () => {
    expect(appCookieHeader('v', true)).toBe(`${APP_COOKIE}=v; Path=/; Max-Age=28800; HttpOnly; SameSite=Lax; Secure`)
    expect(appCookieHeader('v', false)).not.toContain('Secure')
    expect(appCookieHeader('v', true)).not.toMatch(/Domain=/i)
  })
})
