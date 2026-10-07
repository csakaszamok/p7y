import { describe, it, expect, vi, beforeEach } from 'vitest'

let all: Array<{ name: string; owner: string; status: string }> = []
vi.mock('../../services/sandbox', () => ({ sandboxService: { listSandboxes: vi.fn(async () => all) } }))
vi.mock('../../services/access', () => ({ visibleSandboxes: vi.fn(async (p: { sub: string }) => all.filter(s => s.owner === p.sub)) }))

const { runningLimit, wakeRefusal, reserveWake, runningStatus } = await import('../../services/quota')
const u = (status: string, name: string, owner = 'u@x') => ({ name, owner, status })

beforeEach(() => {
  vi.stubEnv('SANDBOX_QUOTA', '1'); vi.stubEnv('SANDBOX_MAX_TOTAL', '0')
  all = [u('running', 'p7y-shop'), u('exited', 'p7y-blog'), u('deep_sleep', 'p7y-old')]
})

describe('runningLimit', () => {
  it('is SANDBOX_QUOTA: 3 by default, 0 = none', () => {
    expect(runningLimit({})).toBe(3)
    expect(runningLimit({ SANDBOX_QUOTA: '1' })).toBe(1)
    expect(runningLimit({ SANDBOX_QUOTA: '0' })).toBeNull()
  })
})

describe('wakeRefusal', () => {
  it('an asleep sandbox: refused while the running limit is used, with the running ones', async () => {
    const r = await wakeRefusal('u@x', 'exited')
    expect(r).toEqual({ reason: 'running', title: 'Running limit reached', limit: 1, running: ['p7y-shop'],
      message: 'Running limit reached: 1 running sandbox allowed, running now: shop. Put one to sleep first.' })
    vi.stubEnv('SANDBOX_QUOTA', '2')
    expect(await wakeRefusal('u@x', 'exited')).toBeNull()
  })
  it('a deep-sleeping one: only the running limit, however many sleep; the admin never', async () => {
    all.push(u('exited', 'p7y-four'))
    expect((await wakeRefusal('u@x', 'deep_sleep'))?.reason).toBe('running')
    expect(await wakeRefusal('admin', 'deep_sleep')).toBeNull()
  })
  it('counts the sandboxes being woken right now as running', async () => {
    all = [u('exited', 'p7y-a'), u('exited', 'p7y-b')]
    expect(await wakeRefusal('u@x', 'exited', ['p7y-a'])).toMatchObject({ reason: 'running', running: ['p7y-a'] })
  })
})

describe('reserveWake', () => {
  it('two asleep sandboxes woken at once with a limit of 1: one passes', async () => {
    all = [u('exited', 'p7y-a'), u('exited', 'p7y-b')]
    const [a, b] = await Promise.all([reserveWake('u@x', 'p7y-a', 'exited'), reserveWake('u@x', 'p7y-b', 'exited')])
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1)
    for (const r of [a, b]) if (r.ok) r.release()
    const again = await reserveWake('u@x', 'p7y-b', 'exited')
    expect(again.ok).toBe(true)
    if (again.ok) again.release()
  })
})

describe('runningStatus', () => {
  it("a user's running count and limit; none for the admin", async () => {
    expect(await runningStatus({ sub: 'u@x', role: 'user', via: 'session' })).toEqual({ max_running: 1, running: 1 })
    expect((await runningStatus({ sub: 'admin', role: 'admin', via: 'admin-token' })).max_running).toBeNull()
  })
})

describe('reserveSandboxSlot: a new sandbox runs', () => {
  it('refused at the running limit, with scope running', async () => {
    const { reserveSandboxSlot } = await import('../../services/quota')
    all = [u('running', 'p7y-shop')]
    expect(await reserveSandboxSlot({ sub: 'u@x', role: 'user', via: 'session' })).toEqual({ ok: false, limit: 1, scope: 'running' })
    vi.stubEnv('SANDBOX_QUOTA', '2')
    const r = await reserveSandboxSlot({ sub: 'u@x', role: 'user', via: 'session' })
    expect(r.ok).toBe(true)
    if (r.ok) r.release()
  })
})

describe('final review fixes', () => {
  it('a swap: the sandbox to sleep does not count; still over the limit when more run', async () => {
    all = [u('running', 'p7y-a'), u('exited', 'p7y-x')]
    const ok = await reserveWake('u@x', 'p7y-x', 'exited', 'p7y-a')
    expect(ok.ok).toBe(true)
    if (ok.ok) ok.release()
    all = [u('running', 'p7y-a'), u('running', 'p7y-b'), u('exited', 'p7y-x')]
    const r = await reserveWake('u@x', 'p7y-x', 'exited', 'p7y-a')
    expect(r).toMatchObject({ ok: false, refusal: { reason: 'running', limit: 1 } })
  })
  it('a create and a wake at the same moment: one passes', async () => {
    const { reserveSandboxSlot } = await import('../../services/quota')
    all = [u('exited', 'p7y-x')]
    const [create, wake] = await Promise.all([reserveSandboxSlot({ sub: 'u@x', role: 'user', via: 'session' }), reserveWake('u@x', 'p7y-x', 'exited')])
    expect([create.ok, wake.ok].filter(Boolean).length).toBe(1)
    for (const r of [create, wake]) if (r.ok) r.release()
  })
})

describe('a sandbox being woken that already runs is counted once', () => {
  it('a create next to 2 running, one of them still in its wake: allowed with a quota of 3', async () => {
    const { reserveSandboxSlot } = await import('../../services/quota')
    vi.stubEnv('SANDBOX_QUOTA', '3')
    all = [u('running', 'p7y-c03'), u('running', 'p7y-c04')]
    const wake = await reserveWake('u@x', 'p7y-c03', 'exited') // c03's wake is still finishing
    expect(wake.ok).toBe(true)
    const create = await reserveSandboxSlot({ sub: 'u@x', role: 'user', via: 'session' })
    expect(create.ok).toBe(true)
    for (const r of [wake, create]) if (r.ok) r.release()
  })
})
