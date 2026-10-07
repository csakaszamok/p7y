import { describe, it, expect, vi } from 'vitest'
import bcrypt from 'bcryptjs'

vi.stubEnv('SESSION_SECRET', 'test-secret')
vi.stubEnv('PUBLIC_URL', 'http://p7y.lvh.me')
vi.stubEnv('ADMIN_TOKEN', 'admin-secret')

vi.mock('../../services/tokens', () => ({
  resolveToken: vi.fn((t: string) =>
    t === 'ldr_good' ? { owner: 'alice@example.com', sandbox: null }
    : t === 'p7y_scoped' ? { owner: 'alice@example.com', sandbox: 'p7y-shop' }
    : null)
}))

import { getPrincipal, requirePrincipal, checkAdminLogin, scopedTokenAllows } from '../../services/principal'
import { createSession } from '../../services/session'

const req = (headers: Record<string, string> = {}, method = 'GET') =>
  new Request('http://p7y.lvh.me/sandboxes', { method, headers: { host: 'p7y.lvh.me', ...headers } })

describe('getPrincipal', () => {
  it('resolves admin token, personal token and session cookie', () => {
    expect(getPrincipal(req({ authorization: 'Bearer admin-secret' }))).toEqual({ sub: 'admin', role: 'admin', via: 'admin-token' })
    expect(getPrincipal(req({ authorization: 'Bearer ldr_good' }))).toEqual({ sub: 'alice@example.com', role: 'user', via: 'token' })
    const cookie = `p7y_session=${createSession('bob@example.com', 'user')}`
    expect(getPrincipal(req({ cookie }))).toEqual({ sub: 'bob@example.com', role: 'user', via: 'session' })
  })

  it('treats unknown bearer tokens and bad cookies as anonymous', () => {
    expect(getPrincipal(req({ authorization: 'Bearer ldr_bad' }))).toBeNull()
    expect(getPrincipal(req({ authorization: 'Bearer something' }))).toBeNull()
    expect(getPrincipal(req({ cookie: 'p7y_session=forged.sig' }))).toBeNull()
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
    const cookie = `p7y_session=${createSession('bob@example.com', 'user')}`
    // Bad bearer should not fall through to the valid cookie
    expect(getPrincipal(req({ authorization: 'Bearer bad', cookie }))).toBeNull()
  })
})

describe('requirePrincipal', () => {
  const session = `p7y_session=${createSession('bob@example.com', 'user')}`

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
    expect(requirePrincipal(req({ cookie: session, origin: 'http://p7y.lvh.me' }, 'POST'))).toMatchObject({ sub: 'bob@example.com' })
    expect(requirePrincipal(req({ cookie: session, referer: 'http://p7y.lvh.me/admin' }, 'DELETE'))).toMatchObject({ sub: 'bob@example.com' })
    expect(requirePrincipal(req({ cookie: session }, 'GET'))).toMatchObject({ sub: 'bob@example.com' })
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
  new Request(`http://p7y.lvh.me${path}`, { method, headers: { host: 'p7y.lvh.me', ...headers } })

describe('sandbox-scoped tokens', () => {
  it('carries the sandbox on the principal, always as a user', () => {
    expect(getPrincipal(req({ authorization: 'Bearer p7y_scoped' })))
      .toEqual({ sub: 'alice@example.com', role: 'user', via: 'token', sandbox: 'p7y-shop' })
    expect(getPrincipal(req({ authorization: 'Bearer ldr_good' }))).not.toHaveProperty('sandbox')
  })

  it('allows exactly the listed routes', () => {
    const allowed: Array<[string, string]> = [
      ['GET', '/sandboxes'], ['GET', '/sandboxes/p7y-shop'], ['PATCH', '/sandboxes/p7y-shop'],
      ['POST', '/sandboxes/p7y-shop/start'], ['POST', '/sandboxes/p7y-shop/stop'], ['POST', '/sandboxes/p7y-shop/restart'], ['POST', '/sandboxes/p7y-shop/deep-sleep'], ['GET', '/sandboxes/p7y-shop/compose'], ['GET', '/sandboxes/p7y-shop/ssh-key'], ['POST', '/sandboxes/p7y-shop/ssh-key'], ['GET', '/sandboxes/p7y-shop/logs/stream'], ['POST', '/sandboxes/p7y-shop/keep-awake'], ['GET', '/sandboxes/p7y-shop/registry'], ['DELETE', '/sandboxes/p7y-shop/registry/todo/sha256:a'],
      ['GET', '/me'], ['GET', '/templates'], ['GET', '/runtimes'], ['GET', '/sandboxes/'],
    ]
    for (const [m, p] of allowed) expect(scopedTokenAllows(m, p), `${m} ${p}`).toBe(true)
    const denied: Array<[string, string]> = [
      ['POST', '/sandboxes'], ['DELETE', '/sandboxes/p7y-shop'], ['GET', '/tokens'], ['POST', '/tokens'],
      ['DELETE', '/tokens/abc'], ['POST', '/sandboxes/p7y-shop/exec'], ['GET', '/sandboxes/p7y-shop/logs'],
      ['PUT', '/sandboxes/p7y-shop'], ['GET', '/Sandboxes'], ['GET', '/admin'], ['GET', '/settings/tokens'],
      ['GET', '/ssh-keys'], ['POST', '/ssh-keys'], ['DELETE', '/ssh-keys/abc'],
    ]
    for (const [m, p] of denied) expect(scopedTokenAllows(m, p), `${m} ${p}`).toBe(false)
  })

  it('requirePrincipal 403s a scoped token outside the allowlist and lets the rest through', async () => {
    const denied = requirePrincipal(at('POST', '/sandboxes', { authorization: 'Bearer p7y_scoped' }))
    expect(denied).toBeInstanceOf(Response)
    expect((denied as Response).status).toBe(403)
    expect(await (denied as Response).json()).toEqual({ error: 'This token is limited to sandbox p7y-shop' })
    expect(requirePrincipal(at('GET', '/sandboxes/p7y-shop', { authorization: 'Bearer p7y_scoped' }))).toMatchObject({ sandbox: 'p7y-shop' })
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
      'sandboxes/[name]/deep-sleep/POST.ts',
      'sandboxes/[name]/keep-awake/POST.ts',
      'sandboxes/[name]/logs/stream/GET.ts',
      'sandboxes/[name]/registry/GET.ts',
      'sandboxes/[name]/registry/[app]/[digest]/DELETE.ts',
      'sandboxes/[name]/restart/POST.ts',
      'sandboxes/[name]/ssh-key/GET.ts',
      'sandboxes/[name]/ssh-key/POST.ts',
      'sandboxes/[name]/start/POST.ts',
      'sandboxes/[name]/stop/POST.ts',
      'templates/GET.ts',
    ])
  })

  it('does not let a future static route under /sandboxes/ through', () => {
    // e.g. a later routes/sandboxes/archive/GET.ts, which the router prefers over [name]
    const withArchive = new Set(['archive'])
    expect(scopedTokenAllows('GET', '/sandboxes/archive', withArchive)).toBe(false)
    expect(scopedTokenAllows('GET', '/sandboxes/archive/', withArchive)).toBe(false)
    expect(scopedTokenAllows('GET', '/sandboxes/p7y-shop', withArchive)).toBe(true)
  })
})
