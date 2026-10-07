import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubEnv('SESSION_SECRET', 'test-secret')
vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
const owners: Record<string, string> = { 'p7y-a1': 'alice@example.com', 'p7y-b1': 'bob@example.com' }
vi.mock('../../services/sandbox', () => ({
  sandboxService: {
    getSandbox: vi.fn(async (name: string) => {
      if (!owners[name]) throw new Error(`Sandbox not found: ${name}`)
      return { name, owner: owners[name] }
    }),
  },
}))
vi.mock('../../services/tokens', () => ({ resolveToken: vi.fn(() => ({ owner: 'alice@example.com', sandbox: null })) }))

const { createSession } = await import('../../services/session')
const { checkTerminalUpgrade, terminalOpened, terminalClosed, MAX_TERMINALS_PER_USER } = await import('../../services/terminalGate')
const cookie = (sub: string, role: 'user' | 'admin' = 'user') => `p7y_session=${createSession(sub, role)}`
const h = (extra: Record<string, string>) => ({ host: 'p7y.lvh.me', origin: 'https://p7y.lvh.me', ...extra })

describe('checkTerminalUpgrade', () => {
  beforeEach(() => { for (let i = 0; i < 10; i++) terminalClosed('alice@example.com') })

  it("lets the owner and the admin in, nobody else's sandbox (reported as missing)", async () => {
    const r = await checkTerminalUpgrade('/sandboxes/p7y-a1/terminal', h({ cookie: cookie('alice@example.com') }))
    expect(r).toMatchObject({ ok: true, name: 'p7y-a1', sub: 'alice@example.com' })
    if (r.ok) r.release()
    expect(await checkTerminalUpgrade('/sandboxes/p7y-a1/terminal', h({ cookie: cookie('admin', 'admin') }))).toMatchObject({ ok: true })
    expect(await checkTerminalUpgrade('/sandboxes/p7y-b1/terminal', h({ cookie: cookie('alice@example.com') }))).toMatchObject({ ok: false, status: 404 })
    expect(await checkTerminalUpgrade('/sandboxes/p7y-zz/terminal', h({ cookie: cookie('alice@example.com') }))).toMatchObject({ ok: false, status: 404 })
  })

  it('refuses without a session, with a token instead of a session, and from another site', async () => {
    expect(await checkTerminalUpgrade('/sandboxes/p7y-a1/terminal', h({}))).toMatchObject({ ok: false, status: 401 })
    expect(await checkTerminalUpgrade('/sandboxes/p7y-a1/terminal', h({ authorization: 'Bearer p7y_x' }))).toMatchObject({ ok: false, status: 401 })
    expect(await checkTerminalUpgrade('/sandboxes/p7y-a1/terminal', h({ cookie: cookie('alice@example.com'), origin: 'https://evil.example' }))).toMatchObject({ ok: false, status: 403 })
    expect(await checkTerminalUpgrade('/sandboxes/p7y-a1/terminal', { host: 'p7y.lvh.me', cookie: cookie('alice@example.com') })).toMatchObject({ ok: false, status: 403 })
  })

  it('takes the slot itself, so many upgrades at once still get at most 5 terminals', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => checkTerminalUpgrade('/sandboxes/p7y-a1/terminal', h({ cookie: cookie('alice@example.com') }))))
    expect(results.filter(r => r.ok)).toHaveLength(MAX_TERMINALS_PER_USER)
    expect(results.filter(r => !r.ok && r.status === 429)).toHaveLength(10 - MAX_TERMINALS_PER_USER)
    for (const r of results) if (r.ok) { r.release(); r.release() } // releasing twice gives back one slot
    expect(await checkTerminalUpgrade('/sandboxes/p7y-a1/terminal', h({ cookie: cookie('alice@example.com') }))).toMatchObject({ ok: true })
  })

  it('ignores other paths and allows at most 5 open terminals per user', async () => {
    expect(await checkTerminalUpgrade('/sandboxes/p7y-a1/other', h({ cookie: cookie('alice@example.com') }))).toMatchObject({ ok: false, status: 404 })
    for (let i = 0; i < MAX_TERMINALS_PER_USER; i++) terminalOpened('alice@example.com')
    expect(await checkTerminalUpgrade('/sandboxes/p7y-a1/terminal', h({ cookie: cookie('alice@example.com') }))).toMatchObject({ ok: false, status: 429 })
    terminalClosed('alice@example.com')
    expect(await checkTerminalUpgrade('/sandboxes/p7y-a1/terminal', h({ cookie: cookie('alice@example.com') }))).toMatchObject({ ok: true })
  })
})
