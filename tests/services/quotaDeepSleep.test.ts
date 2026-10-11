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
vi.mock('../../services/sandbox', () => ({ sandboxService: { listSandboxStates: vi.fn(async () => all) } }))
vi.mock('../../services/access', () => ({ visibleSandboxStates: vi.fn(async (p: { sub: string; role: string }) => all.filter(s => p.role === 'admin' || s.owner === p.sub)) }))

const { quotaStatus, reserveSandboxSlot, serverUsed, wakeRefusal } = await import('../../services/quota')
const dora = { sub: 'dora@x', role: 'user' as const, via: 'session' as const }

describe('only running sandboxes count against the quota', () => {
  beforeEach(() => { reset(); vi.stubEnv('SANDBOX_QUOTA', '3'); vi.stubEnv('SANDBOX_MAX_TOTAL', '0') })

  it('asleep and deep-sleeping ones count nowhere, not for the user and not for the server', async () => {
    expect(await quotaStatus(dora)).toEqual({ quota: 3, sandbox_count: 1 })
    expect(await serverUsed()).toBe(7) // dora's and erin's running ones and the admin's 5; asleep and deep sleep take none
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

  it("the server limit refuses any wake (it takes a running place), the admin's running ones count; the admin is never refused", async () => {
    vi.stubEnv('SANDBOX_MAX_TOTAL', '7')
    expect((await wakeRefusal('erin@x', 'deep_sleep'))?.message).toBe('The server is full (7 sandboxes running): ask the administrator.')
    expect((await wakeRefusal('dora@x', 'exited'))?.reason).toBe('server')
    expect(await wakeRefusal('admin', 'deep_sleep')).toBeNull()
    vi.stubEnv('SANDBOX_MAX_TOTAL', '8')
    expect(await wakeRefusal('dora@x', 'exited')).toBeNull()
  })
  it('a swap frees the place of the one it puts to sleep', async () => {
    vi.stubEnv('SANDBOX_MAX_TOTAL', '7')
    expect(await wakeRefusal('dora@x', 'exited', [], { freeing: 'p7y-d1' })).toBeNull()
  })
})
