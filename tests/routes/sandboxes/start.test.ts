import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
const owners: Record<string, string> = { 'p9m-x': 'u@x', 'p9m-shop': 'u@x', 'p9m-theirs': 'v@x' }
vi.mock('../../../services/sandbox', () => ({ sandboxService: {
  getSandbox: vi.fn(async (n: string) => { if (!owners[n]) throw new Error(`Sandbox not found: ${n}`); return { name: n, owner: owners[n], status: 'exited' } }),
  startSandbox: vi.fn(async () => {}),
} }))
vi.mock('../../../services/tokens', () => ({ resolveToken: vi.fn((t: string) => (t === 'p9m_u' ? { owner: 'u@x', sandbox: null } : null)) }))
const { sandboxService } = await import('../../../services/sandbox')
const { default: post } = await import('../../../routes/sandboxes/[name]/start/POST')
const req = (n: string, body?: unknown) => new Request(`http://localhost/sandboxes/${n}/start`, { method: 'POST', headers: { Authorization: 'Bearer p9m_u', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })

beforeEach(() => { vi.mocked(sandboxService.startSandbox).mockReset() })

describe('POST /sandboxes/:name/start', () => {
  it('at the limit: 409 with the reason and the running sandboxes', async () => {
    const refusal = { reason: 'running', title: 'Running limit reached', message: 'Running limit reached: 1 running sandbox allowed, running now: shop. Put one to sleep first.', limit: 1, running: ['p9m-shop'] }
    vi.mocked(sandboxService.startSandbox).mockRejectedValueOnce(Object.assign(new Error(refusal.message), { code: 'LIMIT', refusal }))
    const res = await post(req('p9m-x'))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: refusal.message, reason: 'running', limit: 1, running: ['p9m-shop'] })
  })
  it('a swap passes the sandbox to put to sleep; one the caller cannot see is 404', async () => {
    expect((await post(req('p9m-x', { sleep: 'p9m-shop' }))).status).toBe(200)
    expect(sandboxService.startSandbox).toHaveBeenCalledWith('p9m-x', { sleep: 'p9m-shop' })
    expect((await post(req('p9m-x', { sleep: 'p9m-theirs' }))).status).toBe(404)
    expect(sandboxService.startSandbox).toHaveBeenCalledTimes(1)
  })
  it('a refused swap is 409; without a body it starts as before', async () => {
    vi.mocked(sandboxService.startSandbox).mockRejectedValueOnce(Object.assign(new Error('p9m-shop is not another running sandbox of the same owner'), { code: 'BAD_SWAP' }))
    expect((await post(req('p9m-x', { sleep: 'p9m-shop' }))).status).toBe(409)
    expect((await post(req('p9m-x'))).status).toBe(200)
    expect(sandboxService.startSandbox).toHaveBeenLastCalledWith('p9m-x', {})
  })
})
