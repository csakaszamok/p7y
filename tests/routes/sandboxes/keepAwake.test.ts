import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
vi.mock('../../../services/sandbox', () => ({
  sandboxService: {
    getSandbox: vi.fn(async (n: string) => {
      if (n === 'p7y-a') return { name: n, owner: 'u@example.com', status: 'running' }
      if (n === 'p7y-zz') return { name: n, owner: 'u@example.com', status: 'exited' }
      if (n === 'p7y-b') return { name: n, owner: 'other@example.com', status: 'running' }
      throw new Error(`Sandbox not found: ${n}`)
    }),
  },
}))
vi.mock('../../../services/tokens', () => ({
  resolveToken: vi.fn((t: string) => t === 'p7y_u' ? { owner: 'u@example.com', sandbox: null } : t === 'p7y_scoped' ? { owner: 'u@example.com', sandbox: 'p7y-a' } : null),
}))
vi.mock('../../../services/wake', () => ({ primeSablierSession: vi.fn(async () => true) }))
vi.mock('../../../services/sleepTimes', () => ({ sleepTimes: vi.fn(async () => ({ stops_in: 1800, stops_at: '2026-10-04T10:30:00.000Z' })) }))
const { primeSablierSession } = await import('../../../services/wake')
const { default: post } = await import('../../../routes/sandboxes/[name]/keep-awake/POST')
const req = (n: string, token?: string) => new Request(`http://localhost/sandboxes/${n}/keep-awake`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} })

describe('POST /sandboxes/:name/keep-awake', () => {
  it('starts the sleep countdown over for a running sandbox (a token for that sandbox too)', async () => {
    for (const t of ['p7y_u', 'p7y_scoped', 'admin-secret']) {
      vi.mocked(primeSablierSession).mockClear()
      const res = await post(req('p7y-a', t))
      expect(res.status, t).toBe(200)
      expect(await res.json()).toEqual({ name: 'p7y-a', stops_in: 1800, stops_at: '2026-10-04T10:30:00.000Z' })
      expect(primeSablierSession).toHaveBeenCalledWith('p7y-a', 3)
    }
  })

  it('409 for a sandbox that is not running, without waking it', async () => {
    vi.mocked(primeSablierSession).mockClear()
    const res = await post(req('p7y-zz', 'p7y_u'))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('not running: start it first')
    expect(primeSablierSession).not.toHaveBeenCalled()
  })

  it('401 without sign-in, 404 for someone else\'s or a missing sandbox', async () => {
    expect((await post(req('p7y-a'))).status).toBe(401)
    expect((await post(req('p7y-b', 'p7y_u'))).status).toBe(404)
    expect((await post(req('p7y-nope', 'p7y_u'))).status).toBe(404)
  })

  it('502 when the sandbox does not take the request', async () => {
    vi.mocked(primeSablierSession).mockResolvedValueOnce(false)
    const res = await post(req('p7y-a', 'p7y_u'))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('could not reach the sandbox: try again')
  })
})
