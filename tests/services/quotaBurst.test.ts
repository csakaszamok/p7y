import { describe, it, expect, vi, beforeEach } from 'vitest'

// SANDBOX_QUOTA is guaranteed; SANDBOX_QUOTA_MAX is how far a user may go above it while the server has room:
// above the guarantee a sandbox that takes a new place must leave every other owner (and one newcomer) room for theirs
type S = { name: string; owner: string; status: string }
let server: S[] = []
vi.mock('../../services/sandbox', () => ({ sandboxService: { listSandboxStates: vi.fn(async () => server) } }))
vi.mock('../../services/access', () => ({ visibleSandboxStates: vi.fn(async (p: { sub: string }) => server.filter(s => s.owner === p.sub)) }))

const { quotaMax, reservedFor, reserveSandboxSlot, wakeRefusal, runningLimit } = await import('../../services/quota')
const user = (sub: string) => ({ sub, role: 'user' as const, via: 'session' as const })
const make = (owner: string, status: string, n: number) => Array.from({ length: n }, (_, i) => ({ name: `p7y-${owner[0]}${status[0]}${i}`, owner, status }))
const create = async (sub: string) => { const r = await reserveSandboxSlot(user(sub)); if (r.ok) r.release(); return r }

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('SANDBOX_QUOTA', '3')
  vi.stubEnv('SANDBOX_QUOTA_MAX', '10')
  vi.stubEnv('SANDBOX_MAX_TOTAL', '20')
})

describe('SANDBOX_QUOTA_MAX', () => {
  it('reads it: unset = the guarantee (no extra), 0 = no maximum, below the guarantee or invalid = the guarantee', () => {
    expect(quotaMax({ SANDBOX_QUOTA: '3' })).toBe(3)
    expect(quotaMax({ SANDBOX_QUOTA: '3', SANDBOX_QUOTA_MAX: '10' })).toBe(10)
    expect(quotaMax({ SANDBOX_QUOTA: '3', SANDBOX_QUOTA_MAX: '0' })).toBeNull()
    expect(quotaMax({ SANDBOX_QUOTA: '3', SANDBOX_QUOTA_MAX: '2' })).toBe(3)
    expect(quotaMax({ SANDBOX_QUOTA: '3', SANDBOX_QUOTA_MAX: 'lots' })).toBe(3)
    expect(quotaMax({ SANDBOX_QUOTA: '0', SANDBOX_QUOTA_MAX: '10' })).toBeNull() // no guarantee limit: nothing to go above
  })
  it('is the running limit', () => {
    expect(runningLimit()).toBe(10)
  })
})

describe('reservedFor', () => {
  it("what every other owner lacks of their guarantee (only running ones hold a place), and one newcomer's guarantee; not the admin's", () => {
    const states = [...make('alice', 'running', 4), ...make('bob', 'running', 1), ...make('carol', 'running', 1), ...make('carol', 'exited', 2), ...make('dave', 'deep_sleep', 3), ...make('admin', 'running', 5)]
    // bob lacks 2, carol 2 (1 running; asleep ones hold no place), dave 3 (deep sleep neither), a newcomer 3
    expect(reservedFor('alice', states, 3)).toBe(2 + 2 + 3 + 3)
    expect(reservedFor('bob', states, 3)).toBe(2 + 3 + 3)
  })
})

describe('a create above the guarantee', () => {
  it('goes through while the others keep room for their guarantee', async () => {
    server = [...make('alice', 'running', 3), ...make('bob', 'running', 1)]
    // 4 taken + this one + bob's 2 + a newcomer's 3 = 10 of 20
    expect((await create('alice')).ok).toBe(true)
  })
  it("is refused when it would eat into another owner's guarantee; the same create within the guarantee is not", async () => {
    server = [...make('alice', 'running', 3), ...make('bob', 'running', 1)]
    vi.stubEnv('SANDBOX_MAX_TOTAL', '9') // 4 + 1 + 2 + 3 = 10 > 9
    expect(await create('alice')).toMatchObject({ ok: false, scope: 'room', limit: 3 })
    expect((await create('bob')).ok).toBe(true)
  })
  it('stops at SANDBOX_QUOTA_MAX', async () => {
    server = make('alice', 'running', 10)
    expect(await create('alice')).toMatchObject({ ok: false, scope: 'running', limit: 10 })
  })
  it('without SANDBOX_QUOTA_MAX nothing changes: the guarantee is the limit', async () => {
    vi.stubEnv('SANDBOX_QUOTA_MAX', '')
    server = make('alice', 'running', 3)
    expect(await create('alice')).toMatchObject({ ok: false, scope: 'running', limit: 3 })
  })
  it('without a server limit there is always room, up to the maximum', async () => {
    vi.stubEnv('SANDBOX_MAX_TOTAL', '0')
    server = [...make('alice', 'running', 5), ...make('bob', 'running', 0)]
    expect((await create('alice')).ok).toBe(true)
  })
})

describe('a wake above the guarantee', () => {
  it('from sleep takes a place too (an asleep one holds none): refused when the others need it', async () => {
    server = [...make('alice', 'running', 3), ...make('alice', 'exited', 1), ...make('bob', 'running', 1)]
    vi.stubEnv('SANDBOX_MAX_TOTAL', '10') // 4 + 1 + bob's 2 + a newcomer's 3 = 10: fits
    expect(await wakeRefusal('alice', 'exited')).toBeNull()
    vi.stubEnv('SANDBOX_MAX_TOTAL', '9')
    expect(await wakeRefusal('alice', 'exited')).toMatchObject({ reason: 'room', limit: 3 })
  })
  it('from deep sleep takes a place: refused when the others need it, with its own reason', async () => {
    server = [...make('alice', 'running', 3), ...make('alice', 'deep_sleep', 1), ...make('bob', 'running', 1)]
    vi.stubEnv('SANDBOX_MAX_TOTAL', '10') // 4 + 1 + bob's 2 + a newcomer's 3 = 10: fits
    expect(await wakeRefusal('alice', 'deep_sleep')).toBeNull()
    vi.stubEnv('SANDBOX_MAX_TOTAL', '9')
    expect(await wakeRefusal('alice', 'deep_sleep')).toMatchObject({ reason: 'room', limit: 3 })
  })
})
