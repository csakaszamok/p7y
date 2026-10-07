import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')

vi.mock('../../../services/sandbox', () => ({
  sandboxService: {
    listSandboxes: vi.fn().mockResolvedValue([
      { name: 'user1', status: 'running', port: 32001, template: 'dind-standard', container_id: 'abc' }
    ])
  }
}))

const { default: handler } = await import('../../../routes/sandboxes/GET')

describe('GET /sandboxes', () => {
  it('returns 200 with list for valid admin token', async () => {
    const req = new Request('http://localhost/sandboxes', {
      headers: { Authorization: 'Bearer admin-secret' }
    })
    const res = await handler(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body[0].name).toBe('user1')
  })

  it('returns 401 without token', async () => {
    const res = await handler(new Request('http://localhost/sandboxes'))
    expect(res.status).toBe(401)
  })
})
