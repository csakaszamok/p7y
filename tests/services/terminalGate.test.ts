import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubEnv('SESSION_SECRET', 'test-secret')
vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
const owners: Record<string, string> = { 'p9m-a1': 'alice@example.com', 'p9m-b1': 'bob@example.com' }
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
const cookie = (sub: string, role: 'user' | 'admin' = 'user') => `p9m_session=${createSession(sub, role)}`
const admin = cookie('admin', 'admin')
const h = (extra: Record<string, string>) => ({ host: 'p9m.lvh.me', origin: 'https://p9m.lvh.me', ...extra })

describe('checkTerminalUpgrade', () => {
  beforeEach(() => { for (let i = 0; i < 10; i++) terminalClosed('admin') })

  it("lets the admin in; a user's sign-in not, not even to their own (headless); a missing one is 404", async () => {
    const r = await checkTerminalUpgrade('/sandboxes/p9m-a1/terminal', h({ cookie: admin }))
    expect(r).toMatchObject({ ok: true, name: 'p9m-a1', sub: 'admin' })
    if (r.ok) r.release()
    expect(await checkTerminalUpgrade('/sandboxes/p9m-a1/terminal', h({ cookie: cookie('alice@example.com') }))).toMatchObject({ ok: false, status: 401 })
    expect(await checkTerminalUpgrade('/sandboxes/p9m-zz/terminal', h({ cookie: admin }))).toMatchObject({ ok: false, status: 404 })
  })

  it('refuses without a session, with a token instead of a session, and from another site', async () => {
    expect(await checkTerminalUpgrade('/sandboxes/p9m-a1/terminal', h({}))).toMatchObject({ ok: false, status: 401 })
    expect(await checkTerminalUpgrade('/sandboxes/p9m-a1/terminal', h({ authorization: 'Bearer p9m_x' }))).toMatchObject({ ok: false, status: 401 })
    expect(await checkTerminalUpgrade('/sandboxes/p9m-a1/terminal', h({ cookie: admin, origin: 'https://evil.example' }))).toMatchObject({ ok: false, status: 403 })
    expect(await checkTerminalUpgrade('/sandboxes/p9m-a1/terminal', { host: 'p9m.lvh.me', cookie: admin })).toMatchObject({ ok: false, status: 403 })
  })

  it("passes on a container of the sandbox's own Docker; refuses an odd name", async () => {
    const r = await checkTerminalUpgrade('/sandboxes/p9m-a1/terminal?container=claude-dev', h({ cookie: admin }))
    expect(r).toMatchObject({ ok: true, name: 'p9m-a1', container: 'claude-dev' })
    if (r.ok) r.release()
    const plain = await checkTerminalUpgrade('/sandboxes/p9m-a1/terminal', h({ cookie: admin }))
    expect(plain.ok && 'container' in plain).toBe(false)
    if (plain.ok) plain.release()
    for (const bad of ['-x', 'a;b', 'a%20b', '..%2Fetc']) {
      expect(await checkTerminalUpgrade(`/sandboxes/p9m-a1/terminal?container=${bad}`, h({ cookie: admin }))).toMatchObject({ ok: false, status: 404 })
    }
  })

  it('takes the slot itself, so many upgrades at once still get at most 5 terminals', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => checkTerminalUpgrade('/sandboxes/p9m-a1/terminal', h({ cookie: admin }))))
    expect(results.filter(r => r.ok)).toHaveLength(MAX_TERMINALS_PER_USER)
    expect(results.filter(r => !r.ok && r.status === 429)).toHaveLength(10 - MAX_TERMINALS_PER_USER)
    for (const r of results) if (r.ok) { r.release(); r.release() } // releasing twice gives back one slot
    expect(await checkTerminalUpgrade('/sandboxes/p9m-a1/terminal', h({ cookie: admin }))).toMatchObject({ ok: true })
  })

  it('ignores other paths and allows at most 5 open terminals per user', async () => {
    expect(await checkTerminalUpgrade('/sandboxes/p9m-a1/other', h({ cookie: admin }))).toMatchObject({ ok: false, status: 404 })
    for (let i = 0; i < MAX_TERMINALS_PER_USER; i++) terminalOpened('admin')
    expect(await checkTerminalUpgrade('/sandboxes/p9m-a1/terminal', h({ cookie: admin }))).toMatchObject({ ok: false, status: 429 })
    terminalClosed('admin')
    expect(await checkTerminalUpgrade('/sandboxes/p9m-a1/terminal', h({ cookie: admin }))).toMatchObject({ ok: true })
  })
})
