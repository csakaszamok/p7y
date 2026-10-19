import { describe, it, expect, beforeEach } from 'vitest'
import { createHubSession, readHubSession, hubCookieHeader, hubViewer, HUB_COOKIE } from '../../../services/hub/session'

beforeEach(() => {
  process.env.SESSION_SECRET = 'test-secret'
  process.env.HOST_DOMAIN = 'example.com'
  process.env.PUBLIC_URL = 'https://p7y.example.com'
  process.env.OIDC_ALLOWED_EMAILS = 'anna@example.com'
  process.env.HUB_ALLOWED_DOMAINS = 'example.com'
})

const req = (cookie?: string) => new Request('https://hub.example.com/', { headers: cookie ? { cookie } : {} })

describe('hub session', () => {
  it('round-trips and expires', () => {
    const v = createHubSession('peter@example.com', 'Péter', 0)
    expect(readHubSession(v, 0)).toMatchObject({ sub: 'peter@example.com', name: 'Péter' })
    expect(readHubSession(v, 8 * 24 * 3600 * 1000)).toBeNull()
    expect(readHubSession(v + 'x', 0)).toBeNull()
  })
  it('is a Secure, host-only cookie on an https Hub', () => {
    const h = hubCookieHeader(HUB_COOKIE, 'v', 60)
    expect(h).toContain('p7y_hub=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure')
    expect(h).not.toContain('Domain=')
  })
  it('hubViewer re-checks the lists', () => {
    expect(hubViewer(req(`p7y_hub=${createHubSession('peter@example.com', null)}`))?.sub).toBe('peter@example.com')
    expect(hubViewer(req(`p7y_hub=${createHubSession('admin', null)}`))?.sub).toBe('admin')
    expect(hubViewer(req(`p7y_hub=${createHubSession('eve@other.org', null)}`))).toBeNull()
    expect(hubViewer(req())).toBeNull()
  })
})
