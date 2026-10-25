import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
const owners: Record<string, string> = { 'p9m-a1': 'alice@example.com', 'p9m-b1': 'bob@example.com', 'p9m-old': 'alice@example.com' }
vi.mock('../../../services/sandbox', () => ({
  sandboxService: {
    getSandbox: vi.fn(async (name: string) => {
      if (!owners[name]) throw new Error(`Sandbox not found: ${name}`)
      return { name, owner: owners[name], ssh: name !== 'p9m-old' }
    }),
  },
}))
const keys = new Map<string, string>([['p9m-a1', 'PRIV-A1']])
vi.mock('../../../services/sandboxSsh', () => ({
  readGeneratedKey: vi.fn((n: string) => keys.get(n) ?? null),
  hasGeneratedKey: vi.fn((n: string) => keys.has(n)),
  sandboxHasSsh: vi.fn((n: string) => n !== 'p9m-old'),
  createGeneratedKey: vi.fn((n: string) => { if (keys.has(n)) throw new Error('exists'); keys.set(n, `PRIV-${n}`); return `PRIV-${n}` }),
}))
vi.mock('../../../services/tokens', () => ({
  resolveToken: vi.fn((t: string) => t === 'p9m_alice' ? { owner: 'alice@example.com', sandbox: null } : t === 'p9m_scoped_a1' ? { owner: 'alice@example.com', sandbox: 'p9m-a1' } : null),
}))

const { default: get } = await import('../../../routes/sandboxes/[name]/ssh-key/GET')
const { default: post } = await import('../../../routes/sandboxes/[name]/ssh-key/POST')
const req = (method: string, name: string, token: string) => new Request(`http://localhost/sandboxes/${name}/ssh-key`, { method, headers: { Authorization: `Bearer ${token}` } })

describe('/sandboxes/:name/ssh-key', () => {
  it('downloads the generated key for the owner, the admin and a token for that sandbox', async () => {
    for (const t of ['p9m_alice', 'admin-secret', 'p9m_scoped_a1']) {
      const res = await get(req('GET', 'p9m-a1', t))
      expect(res.status, t).toBe(200)
      expect(await res.text()).toBe('PRIV-A1')
      expect(res.headers.get('content-disposition')).toBe('attachment; filename="a1.key"')
    }
  })

  it("404s someone else's sandbox and a sandbox without a generated key", async () => {
    expect((await get(req('GET', 'p9m-b1', 'p9m_alice'))).status).toBe(404)
    const none = await get(req('GET', 'p9m-old', 'p9m_alice'))
    expect(none.status).toBe(404)
    expect(await none.json()).toEqual({ error: 'No generated SSH key' })
  })

  it('creates one where missing, 409 when it exists, 400 without SSH', async () => {
    keys.delete('p9m-b1')
    const made = await post(req('POST', 'p9m-b1', 'admin-secret'))
    expect(made.status).toBe(201)
    expect(await made.json()).toEqual({ private_key: 'PRIV-p9m-b1' })
    const again = await post(req('POST', 'p9m-b1', 'admin-secret'))
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'This sandbox already has a generated key' })
    const old = await post(req('POST', 'p9m-old', 'p9m_alice'))
    expect(old.status).toBe(400)
    expect(await old.json()).toEqual({ error: 'This sandbox has no SSH (created before it)' })
  })
})
