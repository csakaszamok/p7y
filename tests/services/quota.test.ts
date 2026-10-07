import { describe, it, expect, vi } from 'vitest'

const owned: Record<string, number> = { 'alice@x.com': 2, 'bob@x.com': 3 }
vi.mock('../../services/access', () => ({
  visibleSandboxes: vi.fn(async (p: { sub: string }) => Array.from({ length: owned[p.sub] ?? 0 }, (_, i) => ({ name: `s${i}`, owner: p.sub, status: 'running' })))
}))

// The whole server: alice 2, bob 3, and the admin's 10 (not counted against the server limit)
let server = [...Array(2).fill('alice@x.com'), ...Array(3).fill('bob@x.com'), ...Array(10).fill('admin')]
vi.mock('../../services/sandbox', () => ({ sandboxService: { listSandboxes: vi.fn(async () => server.map((owner, i) => ({ name: `p${i}`, owner, status: 'exited' }))) } }))

import { quotaLimit, quotaStatus, quotaExceeded, serverLimit, serverUsed } from '../../services/quota'
const user = (sub: string) => ({ sub, role: 'user' as const, via: 'session' as const })
const admin = { sub: 'admin', role: 'admin' as const, via: 'admin-token' as const }

describe('quota', () => {
  it('reads SANDBOX_QUOTA: default 3, 0 = unlimited, invalid → default', () => {
    expect(quotaLimit({})).toBe(3)
    expect(quotaLimit({ SANDBOX_QUOTA: '5' })).toBe(5)
    expect(quotaLimit({ SANDBOX_QUOTA: '0' })).toBeNull()
    expect(quotaLimit({ SANDBOX_QUOTA: '-1' })).toBe(3)
    expect(quotaLimit({ SANDBOX_QUOTA: 'lots' })).toBe(3)
  })

  it('blocks a user at the limit, not below it', async () => {
    vi.stubEnv('SANDBOX_QUOTA', '3')
    expect(await quotaExceeded(user('alice@x.com'))).toBeNull()
    expect(await quotaExceeded(user('bob@x.com'))).toBe(3)
    expect(await quotaStatus(user('bob@x.com'))).toEqual({ quota: 3, sandbox_count: 3 })
  })

  it('never limits the admin; 0 means unlimited for everyone', async () => {
    vi.stubEnv('SANDBOX_QUOTA', '1')
    expect(await quotaExceeded(admin)).toBeNull()
    expect((await quotaStatus(admin)).quota).toBeNull()
    vi.stubEnv('SANDBOX_QUOTA', '0')
    expect(await quotaExceeded(user('bob@x.com'))).toBeNull()
  })
})

describe('reserveSandboxSlot', () => {
  it('lets only one of several concurrent creates through at the limit', async () => {
    vi.stubEnv('SANDBOX_QUOTA', '3')
    const { reserveSandboxSlot } = await import('../../services/quota')
    // alice has 2 of 3: of three parallel creates exactly one may proceed
    const results = await Promise.all([1, 2, 3].map(() => reserveSandboxSlot(user('alice@x.com'))))
    expect(results.filter(r => r.ok).length).toBe(1)
    expect(results.filter(r => !r.ok).every(r => !r.ok && r.limit === 3)).toBe(true)
    for (const r of results) if (r.ok) r.release()
    // once released, the next create is allowed again
    const again = await reserveSandboxSlot(user('alice@x.com'))
    expect(again.ok).toBe(true)
    if (again.ok) again.release()
  })

  it('never limits the admin and is a no-op when the quota is off', async () => {
    const { reserveSandboxSlot } = await import('../../services/quota')
    vi.stubEnv('SANDBOX_QUOTA', '1')
    expect((await reserveSandboxSlot(admin)).ok).toBe(true)
    vi.stubEnv('SANDBOX_QUOTA', '0')
    const bob = await reserveSandboxSlot(user('bob@x.com'))
    expect(bob.ok).toBe(true)
    if (bob.ok) bob.release() // a reservation is taken now (the running limit), so give it back
  })
})

describe('server limit (SANDBOX_MAX_TOTAL)', () => {
  it('reads SANDBOX_MAX_TOTAL: 200 by default (the Docker subnets of a host), 0 = none, invalid → default', () => {
    expect(serverLimit({})).toBe(200)
    expect(serverLimit({ SANDBOX_MAX_TOTAL: '0' })).toBeNull()
    expect(serverLimit({ SANDBOX_MAX_TOTAL: '30' })).toBe(30)
    expect(serverLimit({ SANDBOX_MAX_TOTAL: 'many' })).toBe(200)
  })
  it("counts the users' sandboxes, not the admin's", async () => {
    expect(await serverUsed()).toBe(5)
  })
  it('refuses a user under their own quota when the server is full; never the admin', async () => {
    const { reserveSandboxSlot } = await import('../../services/quota')
    vi.stubEnv('SANDBOX_QUOTA', '3')
    vi.stubEnv('SANDBOX_MAX_TOTAL', '5')
    const r = await reserveSandboxSlot(user('alice@x.com'))
    expect(r).toEqual({ ok: false, limit: 5, scope: 'server' })
    const a = await reserveSandboxSlot(admin)
    expect(a.ok).toBe(true)
    vi.stubEnv('SANDBOX_MAX_TOTAL', '6')
    const ok = await reserveSandboxSlot(user('alice@x.com'))
    expect(ok.ok).toBe(true)
    // one place left on the server: a parallel create by someone else must not take it too
    const other = await reserveSandboxSlot(user('carol@x.com'))
    expect(other).toEqual({ ok: false, limit: 6, scope: 'server' })
    if (ok.ok) ok.release()
    vi.stubEnv('SANDBOX_MAX_TOTAL', '')
  })
  it("a user's own quota (running sandboxes) says scope: running", async () => {
    const { reserveSandboxSlot } = await import('../../services/quota')
    vi.stubEnv('SANDBOX_QUOTA', '3')
    expect(await reserveSandboxSlot(user('bob@x.com'))).toEqual({ ok: false, limit: 3, scope: 'running' })
  })
})

