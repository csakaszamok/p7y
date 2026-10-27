import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../services/wake', () => ({
  wakeByHost: vi.fn(async (host: string) =>
    host.startsWith('lim-') ? { result: 'limit', name: 'p9m-lim', refusal: { reason: 'running', title: 'Running limit reached', message: 'x', limit: 1, running: ['p9m-shop'] } }
      : host.startsWith('room-') ? { result: 'limit', name: 'p9m-room', refusal: { reason: 'room', title: 'No room above your guarantee', message: 'x', limit: 3, running: ['p9m-shop'] } }
      : host.startsWith('as-') ? { result: 'started', name: 'p9m-as', from: 'asleep' }
      : host.startsWith('ds-') ? { result: 'started', name: 'p9m-ds', from: 'deep_sleep' }
      : host.startsWith('ip-') ? { result: 'in_progress', name: 'p9m-ip' }
      : host.startsWith('old-') ? { result: 'outdated', name: 'p9m-old' }
      : host.startsWith('nr-') ? { result: 'no_route', name: 'p9m-nr' }
      : { result: 'not_found' }),
  movedAppHost: vi.fn((host: string) => host.startsWith('mv-') ? host.replace(/\.p9m\.dev$/, '.p9m.app') : null),
}))

// App access: own-* is an owner-only app this visitor may not open (yet); pub-* answers 200; others are not known
vi.mock('../../../services/appAccess/decide', () => ({
  decide: vi.fn(async ({ host }: { host: string }) =>
    host.startsWith('own-') ? { status: 302, headers: { Location: 'https://p9m.lvh.me/auth/app/start?rd=x', 'Set-Cookie': '__p9m_app=v; Path=/' } }
      : host.startsWith('pub-') ? { status: 200, headers: { Cookie: '', 'X-P9m-User': '' } }
      : { status: 404, headers: {} })
}))
vi.stubEnv('PUBLIC_URL', 'https://p9m.lvh.me')
const { default: handler } = await import('../../../routes/wake/GET')
const req = (host: string) => new Request('http://localhost/wake', { headers: { host } })

describe('GET /wake', () => {
  it("an app's address from before APPS_DOMAIN: 308 to the same path under the apps domain", async () => {
    const res = await handler(new Request('http://localhost/wake?q=1', { headers: { host: 'mv-web.p9m.dev', 'x-replaced-path': '/a/b', 'x-forwarded-proto': 'https' } }))
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://mv-web.p9m.app/a/b?q=1')
  })

  it('404s for hosts without a sandbox', async () => {
    expect((await handler(req('nope.lvh.me'))).status).toBe(404)
  })

  it("the waiting page asks Purgatorium whether the address's app answers before opening it", async () => {
    const html = await (await handler(req('ds-web.lvh.me'))).text()
    expect(html).toContain('data-ready="https://p9m.lvh.me/wake/ready?host=ds-web.lvh.me"')
  })

  it('serves an auto-refreshing waiting page for a deep-sleeping sandbox', async () => {
    const res = await handler(req('ds-web.lvh.me'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const html = await res.text()
    expect(html).toContain('Sandbox is waking up')
    expect(html).toContain('<meta http-equiv="refresh" content="3">')
    expect(html).toContain('p9m-ds')
  })

  it('the waiting page carries the embers and the poller inline (it is served on the sandbox host, not Purgatorium’s)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const html = await (await handler(req('ds-web.lvh.me'))).text()
    expect(html).toContain('data-p9m-waiting')
    expect(html).toContain('<noscript><meta http-equiv="refresh" content="3"></noscript>')
    for (const f of ['embers.js', 'waiting.js']) {
      expect(html, f).toContain(fs.readFileSync(path.join(process.cwd(), 'ui', f), 'utf8').trim())
    }
    expect(html).not.toContain('src="/assets/')
    expect(html).toContain('data-coal')
  })

  it('escapes the sandbox name in the waiting page', async () => {
    const { wakeByHost } = await import('../../../services/wake')
    vi.mocked(wakeByHost).mockResolvedValueOnce({ result: 'started', name: '<img src=x onerror=alert(1)>' } as never)
    const html = await (await handler(req('ds-x.lvh.me'))).text()
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('logs which address and client woke a deep-sleeping sandbox', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await handler(new Request('http://localhost/wake', { headers: { host: 'ds-portainer.lvh.me', 'user-agent': 'Mozilla/5.0 Test' } }))
    expect(log).toHaveBeenCalledWith('[wake] p9m-ds: a request for ds-portainer.lvh.me (Mozilla/5.0 Test) wakes it from deep sleep')
    log.mockRestore()
  })

  it('explains a sandbox created before HTTPS was enabled (409, no reload loop)', async () => {
    const res = await handler(req('old-web.lvh.me'))
    expect(res.status).toBe(409)
    const html = await res.text()
    expect(html).toContain('created before HTTPS was enabled')
    expect(html).not.toContain('http-equiv="refresh"')
  })

  it('explains a running sandbox that no route reaches at this address (502, no reload loop)', async () => {
    const res = await handler(req('nr-web.lvh.me'))
    expect(res.status).toBe(502)
    const html = await res.text()
    expect(html).toContain('does not reach the sandbox')
    expect(html).toContain('p9m-nr')
    expect(html).not.toContain('http-equiv="refresh"')
  })

  it('at the running limit: says the limit was reached, what runs, where the owner chooses; retries every 30 s', async () => {
    const res = await handler(req('lim-web.lvh.me'))
    expect(res.status).toBe(409)
    const html = await res.text()
    expect(html).toContain('<title>Running limit reached — p9m-lim</title>')
    expect(html).toContain('This sandbox is asleep and cannot wake up: its owner reached their limit of 1 running sandbox.')
    // a public page: the owner's other sandboxes (their addresses) are not named here, only in the signed-in panel
    expect(html).not.toContain('shop')
    expect(html).toContain('href="https://p9m.lvh.me/?wake=p9m-lim"')
    expect(html).toContain('<meta http-equiv="refresh" content="30">')
  })
  it('above the guarantee with no room to spare: says so, links the owner to Purgatorium, retries every 30 s', async () => {
    const res = await handler(req('room-web.lvh.me'))
    expect(res.status).toBe(409)
    const html = await res.text()
    expect(html).toContain('<title>No room above your guarantee — p9m-room</title>')
    expect(html).toContain("This sandbox cannot wake up now: its owner has more than the 3 running sandboxes guaranteed to them, and the server has no room to spare for others' guarantees.")
    expect(html).not.toContain('shop')
    expect(html).toContain('<meta http-equiv="refresh" content="30">')
  })
  // Its reloads used to say "rebuilding after a long sleep" for a sandbox that had only been asleep
  it('a wake in progress from somewhere unknown says waking up; only deep sleep says rebuilding', async () => {
    const html = await (await handler(req('ip-web.lvh.me'))).text()
    expect(html).toContain('waking up')
    expect(html).not.toContain('rebuilding')
    expect(await (await handler(req('ds-web.lvh.me'))).text()).toContain('rebuilding after a long sleep')
  })
  // A wake from sleep takes seconds: a reload every 3 s added up to 3 s; deep sleep rebuilds, every 3 s is plenty
  it('reloads every second while waking from sleep, every 3 s from deep sleep', async () => {
    expect(await (await handler(req('as-web.lvh.me'))).text()).toContain('<meta http-equiv="refresh" content="1">')
    expect(await (await handler(req('ds-web.lvh.me'))).text()).toContain('<meta http-equiv="refresh" content="3">')
  })
  it('waking from asleep: the waiting page says waking up, and carries the marker p9m waits on', async () => {
    const html = await (await handler(req('as-web.lvh.me'))).text()
    expect(html).toContain('waking up')
    expect(html).toContain('data-p9m-waiting')
  })
})

describe('GET /wake: app access', () => {
  it('an app this visitor may not open: the decision (sign-in, or the cookie), and no wake', async () => {
    const { wakeByHost } = await import('../../../services/wake')
    const { decide } = await import('../../../services/appAccess/decide')
    vi.mocked(wakeByHost).mockClear()
    const res = await handler(new Request('http://localhost/wake', { headers: { host: 'own-web.lvh.me', 'x-replaced-path': '/a', 'x-forwarded-proto': 'https', cookie: 'k=1' } }))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://p9m.lvh.me/auth/app/start?rd=x')
    expect(res.headers.get('set-cookie')).toBe('__p9m_app=v; Path=/')
    expect(wakeByHost).not.toHaveBeenCalled()
    expect(decide).toHaveBeenCalledWith({ host: 'own-web.lvh.me', proto: 'https', uri: '/a', cookie: 'k=1' })
  })
  it('allowed (200) or not a known app (404): wakes as before', async () => {
    const { wakeByHost } = await import('../../../services/wake')
    vi.mocked(wakeByHost).mockClear()
    await handler(req('pub-web.lvh.me'))
    await handler(req('as-web.lvh.me'))
    expect(wakeByHost).toHaveBeenCalledTimes(2)
  })
  it('the landing of an asleep app keeps its query: the ticket reaches the decision (no redirect loop)', async () => {
    const { decide } = await import('../../../services/appAccess/decide')
    vi.mocked(decide).mockClear()
    // replacepath: X-Replaced-Path is the path alone, the query stays on the request
    await handler(new Request('http://localhost/wake?ticket=t1&rd=%2Fx', { headers: { host: 'own-web.lvh.me', 'x-replaced-path': '/__p9m/auth' } }))
    expect(vi.mocked(decide).mock.calls[0][0].uri).toBe('/__p9m/auth?ticket=t1&rd=%2Fx')
  })
})

