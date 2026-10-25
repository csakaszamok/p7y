import { describe, it, expect, vi } from 'vitest'

// /me counts the caller's sandboxes three ways (quota, running, server places): from one listing, not three
vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
vi.stubEnv('SANDBOX_MAX_TOTAL', '10')
vi.mock('../../services/tokens', () => ({ resolveToken: vi.fn((t: string) => (t === 'p9m_u' ? { owner: 'u@example.com', sandbox: null } : null)) }))
const all = [
  { name: 'p9m-a', owner: 'u@example.com', status: 'running' },
  { name: 'p9m-b', owner: 'u@example.com', status: 'exited' },
  { name: 'p9m-c', owner: 'other@example.com', status: 'running' }
]
const listSandboxStates = vi.fn(async () => all)
vi.mock('../../services/sandbox', () => ({ sandboxService: { listSandboxStates } }))
vi.mock('../../services/docker', () => ({ hostResources: vi.fn(async () => null) }))
const { default: me } = await import('../../routes/me/GET')
const req = (t: string) => new Request('http://localhost/me', { headers: { Authorization: `Bearer ${t}` } })

describe('GET /me lists the sandboxes once', () => {
  it('a user: one listing, the same counts', async () => {
    listSandboxStates.mockClear()
    const body = await (await me(req('p9m_u'))).json()
    expect(listSandboxStates).toHaveBeenCalledTimes(1)
    expect(body).toMatchObject({ sandbox_count: 1, running: 1, server_places: { used: 2, limit: 10 } })
  })
  it('the admin: one listing, everyone\'s running ones', async () => {
    listSandboxStates.mockClear()
    const body = await (await me(req('admin-secret'))).json()
    expect(listSandboxStates).toHaveBeenCalledTimes(1)
    expect(body).toMatchObject({ sandbox_count: 2, running: 0, server_places: { used: 2, limit: 10 } })
  })
})
