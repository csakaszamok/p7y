import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('SESSION_SECRET', 'test-secret')
vi.stubEnv('PUBLIC_URL', 'http://p9m.lvh.me')
const { createSession } = await import('../../services/session')
const get = (await import('../../routes/me/active/GET')).default
const post = (await import('../../routes/me/active/POST')).default

const req = (method: string, cookie?: string, origin = 'http://p9m.lvh.me') =>
  new Request('http://p9m.lvh.me/me/active', { method, headers: { host: 'p9m.lvh.me', origin, ...(cookie ? { cookie: `p9m_session=${cookie}` } : {}) } })

describe('/me/active', () => {
  it('GET tells how long is left, without renewing; POST renews (a new cookie) and tells the full time', async () => {
    const tenMinAgo = createSession('alice@example.com', 'user', Date.now() - 10 * 60_000)
    const g = get(req('GET', tenMinAgo))
    expect(g.status).toBe(200)
    expect(g.headers.get('set-cookie')).toBeNull()
    const left = (await g.json()).idle_left
    expect(left).toBeGreaterThan(19 * 60); expect(left).toBeLessThanOrEqual(20 * 60)
    const p = post(req('POST', tenMinAgo))
    expect(p.status).toBe(200)
    expect(p.headers.get('set-cookie')).toMatch(/^p9m_session=/)
    expect(await p.json()).toMatchObject({ idle_timeout: 1800 })
  })

  it('no session, an ended one, or another site: refused', async () => {
    expect(get(req('GET')).status).toBe(401)
    const ended = createSession('alice@example.com', 'user', Date.now() - 31 * 60_000)
    expect(post(req('POST', ended)).status).toBe(401)
    expect(post(req('POST', createSession('alice@example.com', 'user'), 'https://evil.example')).status).toBe(403)
  })
})
