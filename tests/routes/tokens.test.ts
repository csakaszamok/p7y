import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.stubEnv('SESSION_SECRET', 'test-secret')
vi.mock('../../services/quota', () => ({ quotaStatus: vi.fn(async () => ({ quota: 3, sandbox_count: 1 })), serverLimit: () => null, serverUsed: async () => 0, runningStatus: async () => ({ max_running: 1, running: 0 }) }))
vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
const FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ldr-routes-')), 'access-tokens.json')
vi.stubEnv('ACCESS_TOKENS_FILE', FILE)
vi.mock('../../services/sandbox', () => ({
  sandboxService: {
    getSandbox: vi.fn(async (name: string) => {
      const owners: Record<string, string> = { 'p7y-shop': 'alice@example.com', 'p7y-bobs': 'bob@example.com', 'p7y-admins': 'admin' }
      if (!owners[name]) throw new Error(`Sandbox not found: ${name}`)
      return { name, owner: owners[name] }
    })
  }
}))

const { createSession } = await import('../../services/session')
const me = (await import('../../routes/me/GET')).default
const listT = (await import('../../routes/tokens/GET')).default
const createT = (await import('../../routes/tokens/POST')).default
const deleteT = (await import('../../routes/tokens/[id]/DELETE')).default

const as = (sub: string, role: 'user' | 'admin' = 'user') => ({
  cookie: `p7y_session=${createSession(sub, role)}`, origin: 'http://p7y.lvh.me', host: 'p7y.lvh.me', 'content-type': 'application/json'
})
const r = (p: string, method: string, headers: Record<string, string>, body?: unknown) =>
  new Request(`http://p7y.lvh.me${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })

describe('token API', () => {
  beforeEach(() => fs.rmSync(FILE, { force: true }))

  it('reports who is calling', async () => {
    expect(await (await me(r('/me', 'GET', as('alice@example.com')))).json()).toMatchObject({ sub: 'alice@example.com', role: 'user', via: 'session', quota: 3, sandbox_count: 1 })
    expect((await me(r('/me', 'GET', {}))).status).toBe(401)
  })

  it('creates a token once, lists it without the secret, and the token authenticates as its owner', async () => {
    const res = await createT(r('/tokens', 'POST', as('alice@example.com'), { name: 'laptop', expires_in: '30d' }))
    expect(res.status).toBe(201)
    const created = await res.json()
    expect(created.token).toMatch(/^p7y_/)
    const listed = await (await listT(r('/tokens', 'GET', as('alice@example.com')))).json()
    expect(listed).toEqual([expect.objectContaining({ id: created.id, name: 'laptop', owner: 'alice@example.com' })])
    expect(JSON.stringify(listed)).not.toContain(created.token)
    const who = await (await me(r('/me', 'GET', { authorization: `Bearer ${created.token}` }))).json()
    expect(who).toMatchObject({ sub: 'alice@example.com', role: 'user', via: 'token', quota: 3, sandbox_count: 1 })
  })

  it('mints a token limited to one of the caller’s own sandboxes', async () => {
    const res = await createT(r('/tokens', 'POST', as('alice@example.com'), { name: 'shop agent', sandbox: 'p7y-shop' }))
    expect(res.status).toBe(201)
    const created = await res.json()
    expect(created.sandbox).toBe('p7y-shop')
    const who = await (await me(r('/me', 'GET', { authorization: `Bearer ${created.token}` }))).json()
    expect(who).toMatchObject({ sub: 'alice@example.com', role: 'user', via: 'token', sandbox: 'p7y-shop' })
    const listed = await (await listT(r('/tokens', 'GET', as('alice@example.com')))).json()
    expect(listed[0].sandbox).toBe('p7y-shop')
  })

  it('refuses a sandbox that is not the caller’s own, the admin included', async () => {
    expect((await createT(r('/tokens', 'POST', as('alice@example.com'), { name: 'x', sandbox: 'p7y-bobs' }))).status).toBe(404)
    expect((await createT(r('/tokens', 'POST', as('alice@example.com'), { name: 'x', sandbox: 'p7y-nope' }))).status).toBe(404)
    expect((await createT(r('/tokens', 'POST', as('admin', 'admin'), { name: 'x', sandbox: 'p7y-shop' }))).status).toBe(404)
    expect((await createT(r('/tokens', 'POST', as('admin', 'admin'), { name: 'x', sandbox: 'p7y-admins' }))).status).toBe(201)
    expect((await createT(r('/tokens', 'POST', as('alice@example.com'), { name: 'x', sandbox: 42 }))).status).toBe(400)
  })

  it('a scoped token cannot mint, list or revoke tokens', async () => {
    const { token } = await (await createT(r('/tokens', 'POST', as('alice@example.com'), { name: 'shop', sandbox: 'p7y-shop' }))).json()
    const bearer = { authorization: `Bearer ${token}`, 'content-type': 'application/json', host: 'p7y.lvh.me' }
    expect((await createT(r('/tokens', 'POST', bearer, { name: 'wider' }))).status).toBe(403)
    expect((await listT(r('/tokens', 'GET', bearer))).status).toBe(403)
    expect((await deleteT(r('/tokens/whatever', 'DELETE', bearer))).status).toBe(403)
  })

  it('validates input', async () => {
    for (const body of [{}, { name: '' }, { name: 'x'.repeat(81) }, { name: 'ok', expires_in: '7d' }]) {
      expect((await createT(r('/tokens', 'POST', as('alice@example.com'), body))).status).toBe(400)
    }
  })

  it('users see and revoke only their own tokens; the admin sees and revokes all', async () => {
    const a = await (await createT(r('/tokens', 'POST', as('alice@example.com'), { name: 'a' }))).json()
    await createT(r('/tokens', 'POST', as('bob@example.com'), { name: 'b' }))
    expect((await (await listT(r('/tokens', 'GET', as('bob@example.com')))).json()).map((t: { name: string }) => t.name)).toEqual(['b'])
    expect((await (await listT(r('/tokens', 'GET', as('admin', 'admin')))).json()).length).toBe(2)
    expect((await deleteT(r(`/tokens/${a.id}`, 'DELETE', as('bob@example.com')))).status).toBe(404)
    expect((await deleteT(r(`/tokens/${a.id}`, 'DELETE', as('admin', 'admin')))).status).toBe(200)
    expect((await me(r('/me', 'GET', { authorization: `Bearer ${a.token}` }))).status).toBe(401)
  })
})
