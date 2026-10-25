import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
const G = 1024 ** 3
vi.mock('../../services/tokens', () => ({ resolveToken: vi.fn((t: string) => (t === 'p9m_u' ? { owner: 'u@example.com', sandbox: null } : null)) }))
let limit: number | null = null
vi.mock('../../services/quota', () => ({ quotaStatus: vi.fn(async () => ({ quota: null, sandbox_count: 0 })), serverLimit: () => limit, serverUsed: async () => 5, runningStatus: async (p: { role: string }) => ({ max_running: p.role === 'admin' ? null : 1, running: 1 }) }))
vi.mock('../../services/docker', () => ({ hostResources: vi.fn(async () => ({ cpus: 20, memory: 32 * G })) }))
vi.mock('../../services/sandbox', () => ({ sandboxService: { listSandboxStates: vi.fn(async () => []) } }))
const { default: me } = await import('../../routes/me/GET')
const req = (t: string) => new Request('http://localhost/me', { headers: { Authorization: `Bearer ${t}` } })

describe('GET /me resources', () => {
  it('gives the defaults and the ceiling; the host size only to the admin', async () => {
    expect((await (await me(req('p9m_u'))).json()).resources).toEqual({ defaults: { cpus: 2, memory: 4 * G }, ceiling: { cpus: 4, memory: 8 * G }, host: null })
    expect((await (await me(req('admin-secret'))).json()).resources.host).toEqual({ cpus: 20, memory: 32 * G })
  })
})

describe('GET /me server_full', () => {
  it('true for a user once the server limit is reached; never for the admin', async () => {
    expect((await (await me(req('p9m_u'))).json()).server_full).toBe(false)
    limit = 5
    expect((await (await me(req('p9m_u'))).json()).server_full).toBe(true)
    expect((await (await me(req('admin-secret'))).json()).server_full).toBe(false)
    limit = 6
    expect((await (await me(req('p9m_u'))).json()).server_full).toBe(false)
  })
})

describe('GET /me running', () => {
  it("the caller's running sandboxes and limit", async () => {
    expect(await (await me(req('p9m_u'))).json()).toMatchObject({ max_running: 1, running: 1 })
    expect((await (await me(req('admin-secret'))).json()).max_running).toBeNull()
  })
})

// The topbar shows them to everyone: the sign-in page does already, publicly
describe('GET /me server_places', () => {
  it("the server's places, taken and the limit, for a user and the admin; null without a limit", async () => {
    limit = 200
    expect((await (await me(req('p9m_u'))).json()).server_places).toEqual({ used: 5, limit: 200 })
    expect((await (await me(req('admin-secret'))).json()).server_places).toEqual({ used: 5, limit: 200 })
    limit = null
    expect((await (await me(req('p9m_u'))).json()).server_places).toBeNull()
  })
})

describe('the Simple / Advanced view', () => {
  it('GET /me says which view the caller has; PUT /me/view changes it, and only to simple or advanced', async () => {
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path')
    vi.stubEnv('USER_PREFS_FILE', path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-')), 'p.json'))
    vi.stubEnv('USER_VIEW_SWITCH', 'true')
    expect((await (await me(req('p9m_u'))).json()).view).toBe('simple')
    expect((await (await me(req('admin-secret'))).json()).view).toBe('advanced')
    const { default: put } = await import('../../routes/me/view/PUT')
    const set = (view: unknown) => put(new Request('http://localhost/me/view', { method: 'PUT', headers: { Authorization: 'Bearer p9m_u', 'Content-Type': 'application/json' }, body: JSON.stringify({ view }) }))
    expect((await set('advanced')).status).toBe(200)
    expect((await (await me(req('p9m_u'))).json()).view).toBe('advanced')
    expect((await set('expert')).status).toBe(400)
  })
  it('without USER_VIEW_SWITCH=true a user stays in Simple and cannot switch (403); the admin can', async () => {
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path')
    vi.stubEnv('USER_PREFS_FILE', path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-')), 'p.json'))
    const { default: put } = await import('../../routes/me/view/PUT')
    const set = (t: string, view: unknown) => put(new Request('http://localhost/me/view', { method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ view }) }))
    try {
      vi.stubEnv('USER_VIEW_SWITCH', 'true')
      expect((await set('p9m_u', 'advanced')).status).toBe(200)
      expect(await (await me(req('p9m_u'))).json()).toMatchObject({ view: 'advanced', view_switch: true })
      vi.stubEnv('USER_VIEW_SWITCH', '')
      // The saved choice is kept, not used
      expect(await (await me(req('p9m_u'))).json()).toMatchObject({ view: 'simple', view_switch: false })
      const refused = await set('p9m_u', 'advanced')
      expect(refused.status).toBe(403)
      expect((await refused.json()).error).toMatch(/USER_VIEW_SWITCH/)
      expect(await (await me(req('admin-secret'))).json()).toMatchObject({ view: 'advanced', view_switch: true })
      expect((await set('admin-secret', 'simple')).status).toBe(200)
      expect((await (await me(req('admin-secret'))).json()).view).toBe('simple')
      vi.stubEnv('USER_VIEW_SWITCH', 'TRUE')
      expect((await (await me(req('p9m_u'))).json()).view).toBe('advanced')
    } finally { vi.stubEnv('USER_VIEW_SWITCH', '') }
  })
})

describe('GET /me: the address', () => {
  // An agent writes it into the project's .p9m/p9m.env; the plugin's settings are not readable to it
  it("says Purgatorium's own address", async () => {
    vi.stubEnv('PUBLIC_URL', 'https://p9m.example.com/')
    try {
      expect((await (await me(req('admin-secret'))).json()).url).toBe('https://p9m.example.com')
    } finally { vi.stubEnv('PUBLIC_URL', '') }
  })
})
