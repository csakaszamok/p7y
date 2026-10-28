import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
vi.mock('../../../services/sandbox', () => ({ sandboxService: { suggestName: vi.fn(async () => 'k3x9q2') } }))

const { default: handler } = await import('../../../routes/sandbox-name/GET')
const { sandboxService } = await import('../../../services/sandbox')
const req = (auth?: string) => new Request('http://localhost/sandbox-name', { headers: auth ? { Authorization: auth } : {} })

describe('GET /sandbox-name', () => {
  it('suggests a free name', async () => {
    const res = await handler(req('Bearer admin-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'k3x9q2' })
  })

  it('503 when none is free; 401 without a sign-in', async () => {
    vi.mocked(sandboxService.suggestName).mockResolvedValueOnce(null)
    expect((await handler(req('Bearer admin-secret'))).status).toBe(503)
    expect((await handler(req())).status).toBe(401)
  })
})
