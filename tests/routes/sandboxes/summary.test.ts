import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
vi.mock('../../../services/tokens', () => ({ resolveToken: vi.fn((t: string) => t === 'p7y_scoped' ? { owner: 'u@x', sandbox: 'p7y-a' } : t === 'p7y_u' ? { owner: 'u@x', sandbox: null } : null) }))
vi.mock('../../../services/summary', () => ({ summaryFor: vi.fn(async (p: { sub: string; role: string }) => ({ who: p.sub, role: p.role })) }))

const { default: get } = await import('../../../routes/sandboxes/summary/GET')
const req = (t?: string) => new Request('http://localhost/sandboxes/summary', { headers: t ? { Authorization: `Bearer ${t}` } : {} })

describe('GET /sandboxes/summary', () => {
  it("the caller's summary: a user's own, the admin's of the server", async () => {
    expect(await (await get(req('p7y_u'))).json()).toEqual({ who: 'u@x', role: 'user' })
    expect((await (await get(req('admin-secret'))).json()).role).toBe('admin')
  })
  it('401 without a token; 403 with a token limited to one sandbox', async () => {
    expect((await get(req())).status).toBe(401)
    expect((await get(req('p7y_scoped'))).status).toBe(403)
  })
})
