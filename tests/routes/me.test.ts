import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
const G = 1024 ** 3
vi.mock('../../services/tokens', () => ({ resolveToken: vi.fn((t: string) => (t === 'p7y_u' ? { owner: 'u@example.com', sandbox: null } : null)) }))
let limit: number | null = null
vi.mock('../../services/quota', () => ({ quotaStatus: vi.fn(async () => ({ quota: null, sandbox_count: 0 })), serverLimit: () => limit, serverUsed: async () => 5, runningStatus: async (p: { role: string }) => ({ max_running: p.role === 'admin' ? null : 1, running: 1 }) }))
vi.mock('../../services/docker', () => ({ hostResources: vi.fn(async () => ({ cpus: 20, memory: 32 * G })) }))
const { default: me } = await import('../../routes/me/GET')
const req = (t: string) => new Request('http://localhost/me', { headers: { Authorization: `Bearer ${t}` } })

describe('GET /me resources', () => {
  it('gives the defaults and the ceiling; the host size only to the admin', async () => {
    expect((await (await me(req('p7y_u'))).json()).resources).toEqual({ defaults: { cpus: 2, memory: 4 * G }, ceiling: { cpus: 4, memory: 8 * G }, host: null })
    expect((await (await me(req('admin-secret'))).json()).resources.host).toEqual({ cpus: 20, memory: 32 * G })
  })
})

describe('GET /me server_full', () => {
  it('true for a user once the server limit is reached; never for the admin', async () => {
    expect((await (await me(req('p7y_u'))).json()).server_full).toBe(false)
    limit = 5
    expect((await (await me(req('p7y_u'))).json()).server_full).toBe(true)
    expect((await (await me(req('admin-secret'))).json()).server_full).toBe(false)
    limit = 6
    expect((await (await me(req('p7y_u'))).json()).server_full).toBe(false)
  })
})

describe('GET /me running', () => {
  it("the caller's running sandboxes and limit", async () => {
    expect(await (await me(req('p7y_u'))).json()).toMatchObject({ max_running: 1, running: 1 })
    expect((await (await me(req('admin-secret'))).json()).max_running).toBeNull()
  })
})
