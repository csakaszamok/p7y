import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
const G = 1024 ** 3
vi.mock('../../../services/sandbox', () => ({ sandboxService: { getSandbox: vi.fn(async (n: string) => ({ name: n, owner: 'u@example.com', status: 'running' })) } }))
vi.mock('../../../services/sleepSettings', async orig => ({
  ...(await orig<object>()),
  updateSleepSettings: vi.fn(async () => ({ idle_timeout: '30m', deep_sleep_after: '7d' })),
  sleepSettingsOf: vi.fn(() => ({ idle_timeout: '30m', deep_sleep_after: '7d' })),
}))
vi.mock('../../../services/docker', () => ({ hostResources: vi.fn(async () => ({ cpus: 20, memory: 32 * G })) }))
vi.mock('../../../services/resourceSettings', () => ({
  applyLimits: vi.fn(async (_n: string, _s: string, l: { cpus?: number; memory?: number }) => {
    if (l.memory === 1 * G) throw new Error('now using 3 GB: stop the sandbox first or choose more')
    return { cpus: l.cpus ?? 2, memory: l.memory ?? 4 * G }
  }),
  limitsOf: vi.fn(() => ({ cpus: 2, memory: 4 * G })),
}))
vi.mock('../../../services/tokens', () => ({
  resolveToken: vi.fn((t: string) => t === 'p7y_u' ? { owner: 'u@example.com', sandbox: null } : t === 'p7y_scoped' ? { owner: 'u@example.com', sandbox: 'p7y-a' } : null),
}))
const { default: patch } = await import('../../../routes/sandboxes/[name]/PATCH')
const req = (body: unknown, token: string) => new Request('http://localhost/sandboxes/p7y-a', {
  method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

describe('PATCH /sandboxes/:name resources', () => {
  it('changes cpus/memory within the ceiling (also with a token for that sandbox)', async () => {
    for (const t of ['p7y_u', 'p7y_scoped']) {
      const res = await patch(req({ cpus: 3, memory: '6g' }, t))
      expect(res.status, t).toBe(200)
      expect((await res.json()).limits).toEqual({ cpus: 3, memory: 6 * G })
    }
  })

  it('refuses a user over the ceiling (403), the admin may (200)', async () => {
    const r = await patch(req({ memory: '12g' }, 'p7y_scoped'))
    expect(r.status).toBe(403)
    expect((await patch(req({ memory: '12g' }, 'admin-secret'))).status).toBe(200)
  })

  it('409 when below current use; sleep settings still work alone and together', async () => {
    const r = await patch(req({ memory: '1g' }, 'p7y_u'))
    expect(r.status).toBe(409)
    expect((await r.json()).error).toBe('now using 3 GB: stop the sandbox first or choose more')
    expect((await patch(req({ idle_timeout: '15m' }, 'p7y_u'))).status).toBe(200)
    const both = await (await patch(req({ idle_timeout: '15m', cpus: 1 }, 'p7y_u'))).json()
    expect(both).toMatchObject({ idle_timeout: '30m', limits: { cpus: 1, memory: 4 * G } })
  })

  it('a refused limit change leaves the sleep settings in the same request unchanged', async () => {
    const { updateSleepSettings } = await import('../../../services/sleepSettings')
    vi.mocked(updateSleepSettings).mockClear()
    const r = await patch(req({ idle_timeout: '15m', memory: '1g' }, 'p7y_u'))
    expect(r.status).toBe(409)
    expect(updateSleepSettings).not.toHaveBeenCalled()
  })

  it('says what can be changed when the body changes nothing', async () => {
    const r = await patch(req({}, 'p7y_u'))
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('nothing to change: give idle_timeout, deep_sleep_after, cpus, memory and/or disk')
  })
})
