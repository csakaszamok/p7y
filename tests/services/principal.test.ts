import { describe, it, expect, vi } from 'vitest'
import bcrypt from 'bcryptjs'

vi.stubEnv('SESSION_SECRET', 'test-secret')
vi.stubEnv('PUBLIC_URL', 'http://p9m.lvh.me')
vi.stubEnv('ADMIN_TOKEN', 'admin-secret')

vi.mock('../../services/tokens', () => ({
  resolveToken: vi.fn((t: string) =>
    t === 'ldr_good' ? { owner: 'alice@example.com', sandbox: null }
    : t === 'p9m_scoped' ? { owner: 'alice@example.com', sandbox: 'p9m-shop' }
    : null)
}))

import { getPrincipal, requirePrincipal, checkAdminLogin, scopedTokenAllows } from '../../services/principal'
import { createSession } from '../../services/session'

const req = (headers: Record<string, string> = {}, method = 'GET') =>
  new Request('http://p9m.lvh.me/sandboxes', { method, headers: { host: 'p9m.lvh.me', ...headers } })

describe('getPrincipal with OIDC_ALLOWED_DOMAINS', () => {
  // Taken off the list: their session and tokens stop at once, not in 7 days or never
  it('drops the session and the tokens of someone no longer allowed; the admin stays', () => {
    vi.stubEnv('OIDC_ALLOWED_DOMAINS', 'partner.org')
    // carol an admin: a user's session reaches no API anyway
    vi.stubEnv('OIDC_ADMIN_EMAILS', 'carol@partner.org')
    try {
      expect(getPrincipal(req({ authorization: 'Bearer ldr_good' }))).toBeNull()
      expect(getPrincipal(req({ cookie: `p9m_session=${createSession('bob@example.com', 'user')}` }))).toBeNull()
      expect(getPrincipal(req({ cookie: `p9m_session=${createSession('carol@partner.org', 'admin')}` }))).toMatchObject({ sub: 'carol@partner.org' })
      expect(getPrincipal(req({ authorization: 'Bearer admin-secret' }))).toMatchObject({ role: 'admin' })
      expect(getPrincipal(req({ cookie: `p9m_session=${createSession('admin', 'admin')}` }))).toMatchObject({ role: 'admin' })
    } finally { vi.stubEnv('OIDC_ALLOWED_DOMAINS', ''); vi.stubEnv('OIDC_ADMIN_EMAILS', '') }
  })
})

describe('getPrincipal', () => {
  it("resolves admin token, personal token and the admin's session cookie", () => {
    expect(getPrincipal(req({ authorization: 'Bearer admin-secret' }))).toEqual({ sub: 'admin', role: 'admin', via: 'admin-token' })
    expect(getPrincipal(req({ authorization: 'Bearer ldr_good' }))).toEqual({ sub: 'alice@example.com', role: 'user', via: 'token' })
    expect(getPrincipal(req({ cookie: `p9m_session=${createSession('admin', 'admin')}` }))).toEqual({ sub: 'admin', role: 'admin', via: 'session' })
  })

  it("headless: a user's session cookie reaches no API", () => {
    expect(getPrincipal(req({ cookie: `p9m_session=${createSession('bob@example.com', 'user')}` }))).toBeNull()
  })

  it('treats unknown bearer tokens and bad cookies as anonymous', () => {
    expect(getPrincipal(req({ authorization: 'Bearer ldr_bad' }))).toBeNull()
    expect(getPrincipal(req({ authorization: 'Bearer something' }))).toBeNull()
    expect(getPrincipal(req({ cookie: 'p9m_session=forged.sig' }))).toBeNull()
    expect(getPrincipal(req())).toBeNull()
  })

  it('rejects bearer tokens that are prefixes or differ only in last char from ADMIN_TOKEN', () => {
    // Prefix of admin-secret
    expect(getPrincipal(req({ authorization: 'Bearer admin-secre' }))).toBeNull()
    // Same length but last char differs
    expect(getPrincipal(req({ authorization: 'Bearer admin-secres' }))).toBeNull()
    // Off by one in middle
    expect(getPrincipal(req({ authorization: 'Bearer admin-sexret' }))).toBeNull()
  })

  it('rejects empty bearer when ADMIN_TOKEN is unset', () => {
    vi.stubEnv('ADMIN_TOKEN', '')
    expect(getPrincipal(req({ authorization: 'Bearer ' }))).toBeNull()
    expect(getPrincipal(req({ authorization: 'Bearer anything' }))).toBeNull()
    vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
  })

  it('does not fall through to session cookie when bearer token is invalid', () => {
    const cookie = `p9m_session=${createSession('bob@example.com', 'user')}`
    // Bad bearer should not fall through to the valid cookie
    expect(getPrincipal(req({ authorization: 'Bearer bad', cookie }))).toBeNull()
  })
})

describe('requirePrincipal', () => {
  const session = `p9m_session=${createSession('admin', 'admin')}`

  it('401s anonymous requests', async () => {
    const r = requirePrincipal(req())
    expect(r).toBeInstanceOf(Response)
    expect((r as Response).status).toBe(401)
  })

  it('rejects cookie-authenticated writes without a same-origin Origin', async () => {
    for (const origin of [undefined, 'http://evil.example']) {
      const h: Record<string, string> = { cookie: session }
      if (origin) h.origin = origin
      const r = requirePrincipal(req(h, 'POST'))
      expect((r as Response).status).toBe(403)
    }
    expect(requirePrincipal(req({ cookie: session, origin: 'http://p9m.lvh.me' }, 'POST'))).toMatchObject({ sub: 'admin' })
    expect(requirePrincipal(req({ cookie: session, referer: 'http://p9m.lvh.me/admin' }, 'DELETE'))).toMatchObject({ sub: 'admin' })
    expect(requirePrincipal(req({ cookie: session }, 'GET'))).toMatchObject({ sub: 'admin' })
  })

  it('does not apply the Origin check to bearer tokens', () => {
    expect(requirePrincipal(req({ authorization: 'Bearer ldr_good' }, 'POST'))).toMatchObject({ via: 'token' })
  })
})

describe('checkAdminLogin', () => {
  it('accepts the configured plain or bcrypt password only', async () => {
    vi.stubEnv('ADMIN_USER', 'admin')
    vi.stubEnv('ADMIN_PASSWORD', 'pw')
    expect(await checkAdminLogin('admin', 'pw')).toBe(true)
    expect(await checkAdminLogin('admin', 'pW')).toBe(false)
    expect(await checkAdminLogin('root', 'pw')).toBe(false)
    vi.stubEnv('ADMIN_PASSWORD', await bcrypt.hash('s3cret', 4))
    expect(await checkAdminLogin('admin', 's3cret')).toBe(true)
    expect(await checkAdminLogin('admin', 'nope')).toBe(false)
    vi.stubEnv('ADMIN_PASSWORD', '')
    expect(await checkAdminLogin('admin', '')).toBe(false)
  })
})

const at = (method: string, path: string, headers: Record<string, string> = {}) =>
  new Request(`http://p9m.lvh.me${path}`, { method, headers: { host: 'p9m.lvh.me', ...headers } })

describe('sandbox-scoped tokens', () => {
  it('carries the sandbox on the principal, always as a user', () => {
    expect(getPrincipal(req({ authorization: 'Bearer p9m_scoped' })))
      .toEqual({ sub: 'alice@example.com', role: 'user', via: 'token', sandbox: 'p9m-shop' })
    expect(getPrincipal(req({ authorization: 'Bearer ldr_good' }))).not.toHaveProperty('sandbox')
  })

  it('allows exactly the listed routes', () => {
    const allowed: Array<[string, string]> = [
      ['GET', '/sandboxes'], ['GET', '/sandboxes/p9m-shop'], ['PATCH', '/sandboxes/p9m-shop'],
      ['POST', '/sandboxes/p9m-shop/start'], ['POST', '/sandboxes/p9m-shop/stop'], ['POST', '/sandboxes/p9m-shop/restart'], ['POST', '/sandboxes/p9m-shop/deep-sleep'], ['GET', '/sandboxes/p9m-shop/compose'], ['GET', '/sandboxes/p9m-shop/ssh-key'], ['POST', '/sandboxes/p9m-shop/ssh-key'], ['GET', '/sandboxes/p9m-shop/logs/stream'], ['POST', '/sandboxes/p9m-shop/keep-awake'], ['GET', '/sandboxes/p9m-shop/registry'], ['DELETE', '/sandboxes/p9m-shop/registry/todo/sha256:a'],
      ['GET', '/me'], ['GET', '/templates'], ['GET', '/runtimes'], ['GET', '/sandboxes/'],
      // its files (the Files tab, and an agent over MCP)
      ['GET', '/sandboxes/p9m-shop/files'], ['DELETE', '/sandboxes/p9m-shop/files'], ['POST', '/sandboxes/p9m-shop/files/mkdir'], ['GET', '/sandboxes/p9m-shop/files/content'], ['PUT', '/sandboxes/p9m-shop/files/content'], ['GET', '/sandboxes/p9m-shop/files/text'], ['GET', '/sandboxes/p9m-shop/volumes'],
      ['GET', '/sandboxes/p9m-shop/containers'],
      // a single-use link to the .p9m folder (get_sandbox gives it the keys anyway)
      ['POST', '/sandboxes/p9m-shop/project-link'],
    ]
    for (const [m, p] of allowed) expect(scopedTokenAllows(m, p), `${m} ${p}`).toBe(true)
    const denied: Array<[string, string]> = [
      ['POST', '/sandboxes'], ['DELETE', '/sandboxes/p9m-shop'], ['GET', '/tokens'], ['POST', '/tokens'],
      ['DELETE', '/tokens/abc'], ['POST', '/sandboxes/p9m-shop/exec'], ['GET', '/sandboxes/p9m-shop/logs'],
      ['PUT', '/sandboxes/p9m-shop'], ['GET', '/Sandboxes'], ['GET', '/admin'], ['GET', '/settings/tokens'],
      ['GET', '/ssh-keys'], ['POST', '/ssh-keys'], ['DELETE', '/ssh-keys/abc'],
    ]
    for (const [m, p] of denied) expect(scopedTokenAllows(m, p), `${m} ${p}`).toBe(false)
  })

  it('requirePrincipal 403s a scoped token outside the allowlist and lets the rest through', async () => {
    const denied = requirePrincipal(at('POST', '/sandboxes', { authorization: 'Bearer p9m_scoped' }))
    expect(denied).toBeInstanceOf(Response)
    expect((denied as Response).status).toBe(403)
    expect(await (denied as Response).json()).toEqual({ error: 'This token is limited to sandbox p9m-shop' })
    expect(requirePrincipal(at('GET', '/sandboxes/p9m-shop', { authorization: 'Bearer p9m_scoped' }))).toMatchObject({ sandbox: 'p9m-shop' })
    expect(requirePrincipal(at('POST', '/sandboxes', { authorization: 'Bearer ldr_good' }))).toMatchObject({ sub: 'alice@example.com' })
  })
})

describe('scoped-token allowlist against the real routes', () => {
  it('reaches exactly the intended handlers, so a new route under routes/ is closed until someone decides', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const root = path.join(process.cwd(), 'routes')
    const handlers: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (/^(GET|POST|PUT|PATCH|DELETE)\.ts$/.test(e.name)) handlers.push(path.relative(root, full).split(path.sep).join('/'))
      }
    }
    walk(root)
    const reachable = handlers.filter(h => {
      const method = h.split('/').pop()!.replace('.ts', '')
      // a sample URL for the handler: [param] segments become a value, "index" is "/"
      const url = '/' + h.split('/').slice(0, -1).map(s => s.startsWith('[') ? 'x' : s).join('/')
      return scopedTokenAllows(method, url === '/index' ? '/' : url)
    }).sort()
    expect(reachable).toEqual([
      'me/GET.ts',
      'runtimes/GET.ts',
      'sandboxes/GET.ts',
      'sandboxes/[name]/GET.ts',
      'sandboxes/[name]/PATCH.ts',
      'sandboxes/[name]/compose/GET.ts',
      'sandboxes/[name]/containers/GET.ts',
      'sandboxes/[name]/deep-sleep/POST.ts',
      'sandboxes/[name]/files/DELETE.ts',
      'sandboxes/[name]/files/GET.ts',
      'sandboxes/[name]/files/content/GET.ts',
      'sandboxes/[name]/files/content/PUT.ts',
      'sandboxes/[name]/files/mkdir/POST.ts',
      'sandboxes/[name]/files/text/GET.ts',
      'sandboxes/[name]/keep-awake/POST.ts',
      'sandboxes/[name]/logs/stream/GET.ts',
      'sandboxes/[name]/mounts/GET.ts',
      'sandboxes/[name]/project-link/POST.ts',
      'sandboxes/[name]/registry/GET.ts',
      'sandboxes/[name]/registry/[app]/[digest]/DELETE.ts',
      'sandboxes/[name]/restart/POST.ts',
      'sandboxes/[name]/ssh-key/GET.ts',
      'sandboxes/[name]/ssh-key/POST.ts',
      'sandboxes/[name]/start/POST.ts',
      'sandboxes/[name]/stop/POST.ts',
      'sandboxes/[name]/volumes/GET.ts',
      'templates/GET.ts',
    ])
  })

  it('does not let a future static route under /sandboxes/ through', () => {
    // e.g. a later routes/sandboxes/archive/GET.ts, which the router prefers over [name]
    const withArchive = new Set(['archive'])
    expect(scopedTokenAllows('GET', '/sandboxes/archive', withArchive)).toBe(false)
    expect(scopedTokenAllows('GET', '/sandboxes/archive/', withArchive)).toBe(false)
    expect(scopedTokenAllows('GET', '/sandboxes/p9m-shop', withArchive)).toBe(true)
  })
})

describe('getPrincipal with OIDC_ADMIN_EMAILS', () => {
  it('the browser session is the admin; the same address with a token is a user', () => {
    vi.stubEnv('OIDC_ADMIN_EMAILS', 'alice@example.com')
    try {
      expect(getPrincipal(req({ cookie: `p9m_session=${createSession('alice@example.com', 'admin')}` }))).toMatchObject({ sub: 'alice@example.com', role: 'admin' })
      expect(getPrincipal(req({ authorization: 'Bearer ldr_good' }))).toMatchObject({ sub: 'alice@example.com', role: 'user' })
    } finally { vi.stubEnv('OIDC_ADMIN_EMAILS', '') }
  })
  it('taken off the list: the admin session is a user one at once, which reaches no API', () => {
    vi.stubEnv('OIDC_ADMIN_EMAILS', '')
    expect(getPrincipal(req({ cookie: `p9m_session=${createSession('alice@example.com', 'admin')}` }))).toBeNull()
  })
})
