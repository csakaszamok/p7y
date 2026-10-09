import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubEnv('SESSION_SECRET', 'test-secret')
vi.stubEnv('ADMIN_TOKEN', 'admin-secret')

const sandboxes = [
  { name: 'leander-a1', owner: 'alice@example.com', status: 'exited' },
  { name: 'leander-b1', owner: 'bob@example.com', status: 'running' }
]

vi.mock('../../../services/sandbox', () => ({
  sandboxService: {
    getSandbox: vi.fn(async (name: string) => {
      const s = sandboxes.find(x => x.name === name)
      if (!s) throw new Error(`Sandbox not found: ${name}`)
      return s
    })
  }
}))
vi.mock('../../../services/tokens', () => ({ resolveToken: vi.fn(() => null) }))
vi.mock('../../../services/sleepSettings', async (orig) => ({
  ...await orig<typeof import('../../../services/sleepSettings')>(),
  updateSleepSettings: vi.fn(async () => ({ idle_timeout: '45m', deep_sleep_after: '7d' }))
}))

vi.mock('../../../services/diskUsage', async (orig) => ({
  ...await orig<typeof import('../../../services/diskUsage')>(),
  setDiskLimit: vi.fn(async () => {}),
  diskOf: vi.fn(() => ({ limit: 50 * 1024 ** 3, used: null, measured_at: null, over: false })),
}))
const { setDiskLimit } = await import('../../../services/diskUsage')
const { createSession } = await import('../../../services/session')
const { updateSleepSettings } = await import('../../../services/sleepSettings')
const patch = (await import('../../../routes/sandboxes/[name]/PATCH')).default

const alice = { cookie: `p7y_session=${createSession('alice@example.com', 'user')}`, origin: 'http://p7y.lvh.me', host: 'p7y.lvh.me', 'content-type': 'application/json' }
const r = (name: string, body: unknown, headers: Record<string, string> = alice) =>
  new Request(`http://p7y.lvh.me/sandboxes/${name}`, { method: 'PATCH', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('PATCH /sandboxes/<name>', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('changes the owner’s sandbox, passing its current status', async () => {
    const res = await patch(r('leander-a1', { idle_timeout: '45m' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'leander-a1', idle_timeout: '45m', deep_sleep_after: '7d', limits: null })
    expect(updateSleepSettings).toHaveBeenCalledWith('leander-a1', 'exited', { idle_timeout: '45m' })
  })

  it('404s someone else’s sandbox without changing it; the admin may change any', async () => {
    expect((await patch(r('leander-b1', { idle_timeout: '45m' }))).status).toBe(404)
    expect(updateSleepSettings).not.toHaveBeenCalled()
    const admin = await patch(r('leander-b1', { deep_sleep_after: 'off' }, { authorization: 'Bearer admin-secret', 'content-type': 'application/json' }))
    expect(admin.status).toBe(200)
    expect(updateSleepSettings).toHaveBeenCalledWith('leander-b1', 'running', { deep_sleep_after: 'off' })
  })

  it('400s invalid values and bad JSON', async () => {
    expect((await patch(r('leander-a1', { idle_timeout: '0m' }))).status).toBe(400)
    expect((await patch(r('leander-a1', {}))).status).toBe(400)
    expect((await patch(r('leander-a1', 'not json'))).status).toBe(400)
    expect(updateSleepSettings).not.toHaveBeenCalled()
  })

  it('401s anonymous callers', async () => {
    expect((await patch(r('leander-a1', { idle_timeout: '45m' }, {}))).status).toBe(401)
  })

  it('the disk limit (a warning threshold): only the admin sets it', async () => {
    const user = await patch(r('leander-a1', { disk: '50g' }))
    expect(user.status).toBe(403)
    expect((await user.json()).error).toMatch(/administrator/)
    expect(setDiskLimit).not.toHaveBeenCalled()
    const admin = await patch(r('leander-b1', { disk: '50g' }, { authorization: 'Bearer admin-secret', 'content-type': 'application/json' }))
    expect(admin.status).toBe(200)
    expect(setDiskLimit).toHaveBeenCalledWith('leander-b1', 50 * 1024 ** 3)
    expect((await admin.json()).disk).toEqual({ limit: 50 * 1024 ** 3, used: null, measured_at: null, over: false })
    expect((await patch(r('leander-b1', { disk: 'huge' }, { authorization: 'Bearer admin-secret', 'content-type': 'application/json' }))).status).toBe(400)
  })
})
