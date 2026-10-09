import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubEnv('SESSION_SECRET', 'test-secret')
vi.stubEnv('PUBLIC_URL', 'http://p7y.lvh.me')
vi.stubEnv('ADMIN_USER', 'admin')
vi.stubEnv('ADMIN_PASSWORD', 'pw')
vi.stubEnv('OIDC_ISSUER', 'https://accounts.example.com')
vi.stubEnv('OIDC_CLIENT_ID', 'cid')
vi.stubEnv('OIDC_CLIENT_SECRET', 'csecret')

let claims: Record<string, unknown> = {}
vi.mock('openid-client', () => ({
  discovery: vi.fn(async () => ({ issuer: 'mock' })),
  allowInsecureRequests: Symbol('insecure'),
  randomPKCECodeVerifier: () => 'verifier',
  calculatePKCECodeChallenge: async () => 'challenge',
  randomState: () => 'state-1',
  randomNonce: () => 'nonce-1',
  buildAuthorizationUrl: (_c: unknown, p: Record<string, string>) => new URL(`https://accounts.example.com/auth?${new URLSearchParams(p)}`),
  authorizationCodeGrant: vi.fn(async (_c: unknown, url: URL, checks: { expectedState: string }) => {
    if (url.searchParams.get('state') !== checks.expectedState) throw new Error('state mismatch')
    return { claims: () => claims }
  })
}))

const { readSession, getCookie } = await import('../../services/session')
const loginPost = (await import('../../routes/login/POST')).default
const logout = (await import('../../routes/logout/POST')).default
const oidcStart = (await import('../../routes/auth/oidc/GET')).default
const callback = (await import('../../routes/auth/callback/GET')).default

const cookieValue = (res: Response, name: string) =>
  res.headers.getSetCookie().find(c => c.startsWith(`${name}=`))?.split(';')[0].slice(name.length + 1)

const form = (fields: Record<string, string>, origin = 'http://p7y.lvh.me') =>
  new Request('http://p7y.lvh.me/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin, host: 'p7y.lvh.me' },
    body: new URLSearchParams(fields).toString()
  })

describe('admin login', () => {
  it('signs the admin in and redirects home', async () => {
    const res = await loginPost(form({ username: 'admin', password: 'pw' }))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
    expect(readSession(cookieValue(res, 'p7y_session'))).toMatchObject({ sub: 'admin', role: 'admin' })
  })

  it('sends wrong credentials and cross-site posts back to the login page', async () => {
    const bad = await loginPost(form({ username: 'admin', password: 'nope' }))
    expect(bad.headers.get('location')).toBe('/login?error=Invalid%20username%20or%20password')
    expect(bad.headers.getSetCookie()).toEqual([])
    const csrf = await loginPost(form({ username: 'admin', password: 'pw' }, 'http://evil.example'))
    expect(csrf.status).toBe(403)
  })

  it('logs out by clearing the cookie', async () => {
    const res = await logout(new Request('http://p7y.lvh.me/logout', { method: 'POST', headers: { origin: 'http://p7y.lvh.me', host: 'p7y.lvh.me' } }))
    expect(res.status).toBe(303)
    expect(res.headers.getSetCookie()[0]).toMatch(/^p7y_session=; .*Max-Age=0/)
  })
})

describe('OIDC login', () => {
  beforeEach(() => { claims = { email: 'Alice@Example.com', email_verified: true } })

  async function start() {
    const res = await oidcStart(new Request('http://p7y.lvh.me/auth/oidc'))
    expect(res.status).toBe(302)
    const target = new URL(res.headers.get('location')!)
    expect(target.searchParams.get('redirect_uri')).toBe('http://p7y.lvh.me/auth/callback')
    expect(target.searchParams.get('code_challenge_method')).toBe('S256')
    return cookieValue(res, 'p7y_oidc')!
  }
  const cb = (flow: string | undefined, state = 'state-1') =>
    callback(new Request(`http://p7y.lvh.me/auth/callback?code=abc&state=${state}`, { headers: flow ? { cookie: `p7y_oidc=${flow}` } : {} }))

  it('creates a user session from a verified email', async () => {
    const res = await cb(await start())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
    expect(readSession(cookieValue(res, 'p7y_session'))).toMatchObject({ sub: 'alice@example.com', role: 'user' })
    expect(res.headers.getSetCookie().some(c => /^p7y_oidc=; .*Max-Age=0/.test(c))).toBe(true)
  })

  it('rejects missing flow, bad state, no email and unverified email', async () => {
    for (const res of [
      await cb(undefined),
      await cb(await start(), 'other-state'),
      await (async () => { claims = { email_verified: true }; return cb(await start()) })(),
      await (async () => { claims = { email: 'x@y.z', email_verified: false }; return cb(await start()) })()
    ]) {
      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toMatch(/^\/login\?error=/)
      expect(cookieValue(res, 'p7y_session')).toBeUndefined()
    }
  })

  it('refuses an account that is not on OIDC_ALLOWED_DOMAINS / OIDC_ALLOWED_EMAILS, and says why', async () => {
    vi.stubEnv('OIDC_ALLOWED_DOMAINS', 'example.com')
    try {
      claims = { email: 'mallory@gmail.com', email_verified: true }
      const res = await cb(await start())
      expect(res.status).toBe(303)
      expect(decodeURIComponent(res.headers.get('location')!)).toContain('mallory@gmail.com) may not sign in here')
      expect(cookieValue(res, 'p7y_session')).toBeUndefined()
      claims = { email: 'Alice@Example.com', email_verified: true }
      expect(readSession(cookieValue(await cb(await start()), 'p7y_session'))).toMatchObject({ sub: 'alice@example.com' })
    } finally { vi.stubEnv('OIDC_ALLOWED_DOMAINS', '') }
  })

  it('rejects a claims email with no "@" (a lax provider could otherwise hand out sub "admin")', async () => {
    claims = { email: 'admin', email_verified: true }
    const res = await cb(await start())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toMatch(/^\/login\?error=/)
    expect(cookieValue(res, 'p7y_session')).toBeUndefined()
  })
})
