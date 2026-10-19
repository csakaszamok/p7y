import { describe, it, expect, beforeEach, vi } from 'vitest'
import os from 'node:os'; import path from 'node:path'; import fs from 'node:fs'
import { startResponse, nextAfterSignIn } from '../../../services/appAccess/start'
import { redeemTicket, _resetSign } from '../../../services/appAccess/sign'

const levels: Record<string, 'domain' | 'owner'> = { 'shop-dom.example.com': 'domain', 'shop-own.example.com': 'owner' }
const deps = (viewer: { sub: string; role: 'user' | 'admin' } | null) => ({
  session: () => viewer,
  access: async (h: string) => levels[h] ? { sandbox: 'p7y-shop', owner: 'bob@example.com', access: levels[h] } : null,
  env: { HOST_DOMAIN: 'example.com' } as NodeJS.ProcessEnv,
})
const at = (rd: string) => new Request(`https://p7y.example.com/auth/app/start?rd=${encodeURIComponent(rd)}`)

describe('/auth/app/start', () => {
  beforeEach(() => { vi.stubEnv('APP_ACCESS_KEY_FILE', path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'st-')), 'k')); _resetSign() })
  it('not signed in: to sign-in, remembering where to come back', async () => {
    const r = await startResponse(at('https://shop-dom.example.com/a'), deps(null))
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/login')
    expect(r.headers.get('set-cookie')).toMatch(/^p7y_next=/)
  })
  it('allowed: a ticket for that host, to its landing path, absolute', async () => {
    const r = await startResponse(at('https://shop-own.example.com/a?b=1'), deps({ sub: 'bob@example.com', role: 'user' }))
    const loc = new URL(r.headers.get('location')!)
    expect(`${loc.origin}${loc.pathname}`).toBe('https://shop-own.example.com/__p7y/auth')
    expect(loc.searchParams.get('rd')).toBe('/a?b=1')
    expect(redeemTicket(loc.searchParams.get('ticket')!, 'shop-own.example.com')).toEqual({ sub: 'bob@example.com', role: 'user' })
  })
  it('signed in, not allowed: a page that says who may open it, no ticket', async () => {
    const r = await startResponse(at('https://shop-own.example.com/'), deps({ sub: 'ann@example.com', role: 'user' }))
    expect(r.status).toBe(403)
    const html = await r.text()
    expect(html).toContain('only to its owner')
    expect(html).toContain('ann@example.com')
    expect(html).not.toContain('ticket')
  })
  it('rd elsewhere than a sandbox app of this Purgatory: 400', async () => {
    for (const rd of ['https://evil.example/x', 'https://p7y.example.com/', 'javascript:alert(1)', 'not a url'])
      expect((await startResponse(at(rd), deps({ sub: 'bob@example.com', role: 'user' }))).status).toBe(400)
  })
  it('after sign-in: back to the start path from p7y_next, nothing else', () => {
    const next = (v: string) => new Request('https://p7y.example.com/', { headers: { cookie: `p7y_next=${encodeURIComponent(v)}` } })
    expect(nextAfterSignIn(next('/auth/app/start?rd=x'))).toBe('/auth/app/start?rd=x')
    expect(nextAfterSignIn(next('https://evil.example/'))).toBeNull()
    expect(nextAfterSignIn(next('/admin'))).toBeNull()
  })
})
