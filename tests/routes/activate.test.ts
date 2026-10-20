import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.stubEnv('SESSION_SECRET', 'test-secret')
vi.stubEnv('PUBLIC_URL', 'https://p7y.example.com')
vi.stubEnv('APP_ACCESS_KEY_FILE', path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-act-')), 'k'))

const sandboxes = [
  { name: 'p7y-shop', owner: 'alice@example.com', status: 'running' },
  { name: 'p7y-blog', owner: 'alice@example.com', status: 'running' },
  { name: 'p7y-off', owner: 'alice@example.com', status: 'deep_sleep' },
  { name: 'p7y-secret', owner: 'bob@example.com', status: 'running' },
]
vi.mock('../../services/sandbox', () => ({
  sandboxService: {
    listSandboxStates: vi.fn(async () => sandboxes),
    getSandbox: vi.fn(async (n: string) => {
      const s = sandboxes.find(x => x.name === n)
      if (!s) throw new Error(`Sandbox not found: ${n}`)
      return s
    }),
  },
}))
vi.mock('../../services/dockerAccess', () => ({
  dockerAccessState: vi.fn((n: string) => n === 'p7y-off' ? 'needs-certs' : 'ready'),
  regenerateCerts: vi.fn(async () => {}),
}))

const { createSession } = await import('../../services/session')
const { startDevice, pollDevice, _resetDevices } = await import('../../services/deviceAuth')
const { nextAfterSignIn } = await import('../../services/appAccess/start')
const { regenerateCerts } = await import('../../services/dockerAccess')
const { default: get } = await import('../../routes/activate/GET')
const { default: post } = await import('../../routes/activate/POST')

const cookie = (sub: string, role: 'user' | 'admin' = 'user') => `p7y_session=${createSession(sub, role)}`
const page = (code: string | null, c?: string) =>
  get(new Request(`https://p7y.example.com/activate${code === null ? '' : `?code=${encodeURIComponent(code)}`}`, { headers: c ? { cookie: c } : {} }))
const send = (fields: Record<string, string>, c: string | undefined = cookie('alice@example.com'), origin = 'https://p7y.example.com') =>
  post(new Request('https://p7y.example.com/activate', {
    method: 'POST', body: new URLSearchParams(fields),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin, ...(c ? { cookie: c } : {}) },
  }))

describe('/activate', () => {
  beforeEach(() => { _resetDevices(); vi.mocked(regenerateCerts).mockReset().mockResolvedValue(undefined) })

  it('no session: to sign-in, and back to this code after it', async () => {
    const res = await page('bcdf-ghjk')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/login')
    const value = res.headers.get('set-cookie')!.split(';')[0].slice('p7y_next='.length)
    expect(nextAfterSignIn(new Request('https://p7y.example.com/', { headers: { cookie: `p7y_next=${value}` } }))).toBe('/activate?code=bcdf-ghjk')
  })

  it('a pending code for my sandbox: the code and the sandbox, fixed', async () => {
    const { user_code } = startDevice('shop')
    const res = await page(user_code.toLowerCase(), cookie('alice@example.com'))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    const html = await res.text()
    expect(html).toContain('Connect Claude Code')
    expect(html).toContain(user_code)
    expect(html).toContain('<b>shop</b>')
    expect(html).toContain('name="sandbox" value="p7y-shop"')
    expect(html).not.toContain('<select')
    expect(html).toMatch(/>Approve</)
    expect(html).toContain('>Deny<')
  })

  it('the pending page warns to approve only a code you started yourself', async () => {
    const { user_code } = startDevice('shop')
    expect(await (await page(user_code, cookie('alice@example.com'))).text())
      .toContain('Approve only if you just ran /p7y:init yourself and Claude Code shows this same code. Never approve a code someone sent you.')
  })

  it('the picker notes a restart only for a sandbox that is awake', async () => {
    const { user_code } = startDevice(null)
    const html = await (await page(user_code, cookie('alice@example.com'))).text()
    expect(html).toMatch(/>off \(enables Docker access\)</)
  })

  it("someone else's sandbox: a select of my own, without that name", async () => {
    const { user_code } = startDevice('p7y-secret')
    const html = await (await page(user_code, cookie('alice@example.com'))).text()
    expect(html).toContain('<select')
    expect(html).toContain('value="p7y-shop"')
    expect(html).toContain('value="p7y-blog"')
    expect(html).not.toContain('secret')
  })

  it('no sandbox in the request: a select of my own; the admin sees only its own too', async () => {
    const { user_code } = startDevice(null)
    expect(await (await page(user_code, cookie('alice@example.com'))).text()).toContain('<select')
    const admin = await (await page(user_code, cookie('admin', 'admin'))).text()
    expect(admin).not.toContain('p7y-shop')
    expect(admin).not.toContain('secret')
  })

  it('the admin may approve a named sandbox of a user', async () => {
    const { user_code } = startDevice('shop')
    expect(await (await page(user_code, cookie('admin', 'admin'))).text()).toContain('name="sandbox" value="p7y-shop"')
  })

  it('Docker access not ready: the button says it enables it', async () => {
    const { user_code } = startDevice('off')
    expect(await (await page(user_code, cookie('alice@example.com'))).text()).toContain('Enable Docker access and approve')
  })

  it('unknown or missing code: 404, run /p7y:init again', async () => {
    for (const c of ['ZZZZ-ZZZZ', null]) {
      const res = await page(c, cookie('alice@example.com'))
      expect(res.status).toBe(404)
      expect(await res.text()).toContain('This code has expired or is unknown: run /p7y:init again.')
    }
  })

  it('escapes what the agent sent', async () => {
    const { user_code } = startDevice('<script>x</script>')
    const html = await (await page(user_code, cookie('alice@example.com'))).text()
    expect(html).not.toContain('<script>x')
  })

  it("POST approve with someone else's sandbox: 403, still pending", async () => {
    const { device_code, user_code } = startDevice('p7y-secret')
    const res = await send({ code: user_code, sandbox: 'p7y-secret', decision: 'approve' })
    expect(res.status).toBe(403)
    expect(pollDevice(device_code)).toEqual({ status: 'pending' })
  })

  it('POST approve my own (short name): approved for me', async () => {
    const { device_code, user_code } = startDevice('shop')
    const res = await send({ code: user_code, sandbox: 'shop', decision: 'approve' })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Approved: go back to Claude Code.')
    expect(pollDevice(device_code)).toEqual({ status: 'approved', sandbox: 'p7y-shop', owner: 'alice@example.com' })
    expect(regenerateCerts).not.toHaveBeenCalled()
  })

  it("the admin approving a user's sandbox: the grant is the owner's", async () => {
    const { device_code, user_code } = startDevice('shop')
    await send({ code: user_code, sandbox: 'p7y-shop', decision: 'approve' }, cookie('admin', 'admin'))
    expect(pollDevice(device_code)).toEqual({ status: 'approved', sandbox: 'p7y-shop', owner: 'alice@example.com' })
  })

  it('POST deny: denied', async () => {
    const { device_code, user_code } = startDevice('shop')
    const res = await send({ code: user_code, sandbox: 'p7y-shop', decision: 'deny' })
    expect(await res.text()).toContain('Denied.')
    expect(pollDevice(device_code)).toEqual({ status: 'denied' })
  })

  it('POST from another site or without a session: refused, still pending', async () => {
    const { device_code, user_code } = startDevice('shop')
    expect((await send({ code: user_code, sandbox: 'p7y-shop', decision: 'approve' }, cookie('alice@example.com'), 'https://evil.example.com')).status).toBe(403)
    const anon = await send({ code: user_code, sandbox: 'p7y-shop', decision: 'approve' }, '')
    expect(anon.status).toBe(303)
    expect(anon.headers.get('location')).toBe('/login')
    expect(pollDevice(device_code)).toEqual({ status: 'pending' })
  })

  it('POST with an unknown code: 404', async () => {
    const res = await send({ code: 'ZZZZ-ZZZZ', sandbox: 'p7y-shop', decision: 'approve' })
    expect(res.status).toBe(404)
  })

  it('POST approve without Docker access: new certificates first (no restart in deep sleep), then approved', async () => {
    const { device_code, user_code } = startDevice('off')
    vi.mocked(regenerateCerts).mockImplementation(async () => { expect(pollDevice(device_code)).toEqual({ status: 'pending' }) })
    await send({ code: user_code, sandbox: 'p7y-off', decision: 'approve' })
    expect(regenerateCerts).toHaveBeenCalledTimes(1)
    expect(vi.mocked(regenerateCerts).mock.calls[0][0]).toBe('p7y-off')
    expect(vi.mocked(regenerateCerts).mock.calls[0][1]).toHaveProperty('restart')
    expect(pollDevice(device_code)).toMatchObject({ status: 'approved', sandbox: 'p7y-off' })
  })

  it('the certificates fail: 500 with the error, still pending', async () => {
    const { device_code, user_code } = startDevice('off')
    vi.mocked(regenerateCerts).mockRejectedValue(new Error('restart <failed>'))
    const res = await send({ code: user_code, sandbox: 'p7y-off', decision: 'approve' })
    expect(res.status).toBe(500)
    expect(await res.text()).toContain('restart &lt;failed&gt;')
    expect(pollDevice(device_code)).toEqual({ status: 'pending' })
  })
})
