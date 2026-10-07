import { describe, it, expect, vi, beforeEach } from 'vitest'

// dora: 2 awake (running, asleep) and 2 in deep sleep; erin: 1 awake; the admin: 5 awake
let all: Array<{ name: string; owner: string; status: string }> = []
const reset = () => {
  all = [
    { name: 'p7y-d1', owner: 'dora@x', status: 'running' },
    { name: 'p7y-d2', owner: 'dora@x', status: 'exited' },
    { name: 'p7y-d3', owner: 'dora@x', status: 'deep_sleep' },
    { name: 'p7y-d4', owner: 'dora@x', status: 'deep_sleep' },
    { name: 'p7y-e1', owner: 'erin@x', status: 'running' },
    ...Array.from({ length: 5 }, (_, i) => ({ name: `p7y-a${i}`, owner: 'admin', status: 'running' })),
  ]
}
vi.mock('../../services/sandbox', () => ({ sandboxService: { listSandboxes: vi.fn(async () => all) } }))
vi.mock('../../services/access', () => ({ visibleSandboxes: vi.fn(async (p: { sub: string; role: string }) => all.filter(s => p.role === 'admin' || s.owner === p.sub)) }))

const { quotaStatus, reserveSandboxSlot, serverUsed, wakeRefusal } = await import('../../services/quota')
const dora = { sub: 'dora@x', role: 'user' as const, via: 'session' as const }

describe('only running sandboxes count against the quota', () => {
  beforeEach(() => { reset(); vi.stubEnv('SANDBOX_QUOTA', '3'); vi.stubEnv('SANDBOX_MAX_TOTAL', '0') })

  it('asleep and deep-sleeping ones count nowhere for the user; the server limit counts running and asleep', async () => {
    expect(await quotaStatus(dora)).toEqual({ quota: 3, sandbox_count: 1 })
    expect(await serverUsed()).toBe(3) // dora running + asleep, erin running; the admin's are not counted
  })

  it('a user with 1 running of 3 may create one, however many sleep', async () => {
    const r = await reserveSandboxSlot(dora)
    expect(r.ok).toBe(true)
    if (r.ok) r.release()
  })

  it('a wake (asleep or deep) is refused only at the running limit', async () => {
    vi.stubEnv('SANDBOX_QUOTA', '1')
    expect((await wakeRefusal('dora@x', 'deep_sleep'))?.reason).toBe('running')
    expect((await wakeRefusal('dora@x', 'exited'))?.reason).toBe('running')
    vi.stubEnv('SANDBOX_QUOTA', '2')
    expect(await wakeRefusal('dora@x', 'deep_sleep')).toBeNull() // d2 asleep does not count
  })

  it('the server limit refuses a wake from deep sleep too; the admin is never refused', async () => {
    vi.stubEnv('SANDBOX_MAX_TOTAL', '3')
    expect((await wakeRefusal('erin@x', 'deep_sleep'))?.message).toMatch(/server is full/)
    expect(await wakeRefusal('admin', 'deep_sleep')).toBeNull()
  })
})
