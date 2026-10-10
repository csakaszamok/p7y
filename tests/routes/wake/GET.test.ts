import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../services/wake', () => ({
  wakeByHost: vi.fn(async (host: string) =>
    host.startsWith('lim-') ? { result: 'limit', name: 'p7y-lim', refusal: { reason: 'running', title: 'Running limit reached', message: 'x', limit: 1, running: ['p7y-shop'] } }
      : host.startsWith('as-') ? { result: 'started', name: 'p7y-as', from: 'asleep' }
      : host.startsWith('ds-') ? { result: 'started', name: 'leander-ds', from: 'deep_sleep' }
      : host.startsWith('ip-') ? { result: 'in_progress', name: 'p7y-ip' }
      : host.startsWith('old-') ? { result: 'outdated', name: 'leander-old' }
      : host.startsWith('nr-') ? { result: 'no_route', name: 'leander-nr' }
      : { result: 'not_found' })
}))

vi.stubEnv('PUBLIC_URL', 'https://p7y.lvh.me')
const { default: handler } = await import('../../../routes/wake/GET')
const req = (host: string) => new Request('http://localhost/wake', { headers: { host } })

describe('GET /wake', () => {
  it('404s for hosts without a sandbox', async () => {
    expect((await handler(req('nope.lvh.me'))).status).toBe(404)
  })

  it('serves an auto-refreshing waiting page for a deep-sleeping sandbox', async () => {
    const res = await handler(req('ds-web.lvh.me'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const html = await res.text()
    expect(html).toContain('Sandbox is waking up')
    expect(html).toContain('<meta http-equiv="refresh" content="3">')
    expect(html).toContain('leander-ds')
  })

  it('the waiting page carries the embers and the poller inline (it is served on the sandbox host, not Purgatory’s)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const html = await (await handler(req('ds-web.lvh.me'))).text()
    expect(html).toContain('data-p7y-waiting')
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
    expect(log).toHaveBeenCalledWith('[wake] leander-ds: a request for ds-portainer.lvh.me (Mozilla/5.0 Test) wakes it from deep sleep')
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
    expect(html).toContain('leander-nr')
    expect(html).not.toContain('http-equiv="refresh"')
  })

  it('at the running limit: says the limit was reached, what runs, where the owner chooses; retries every 30 s', async () => {
    const res = await handler(req('lim-web.lvh.me'))
    expect(res.status).toBe(409)
    const html = await res.text()
    expect(html).toContain('<title>Running limit reached — p7y-lim</title>')
    expect(html).toContain('This sandbox is asleep and cannot wake up: its owner reached their limit of 1 running sandbox.')
    // a public page: the owner's other sandboxes (their addresses) are not named here, only in the signed-in panel
    expect(html).not.toContain('shop')
    expect(html).toContain('href="https://p7y.lvh.me/?wake=p7y-lim"')
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
  it('waking from asleep: the waiting page says waking up, and carries the marker p7y waits on', async () => {
    const html = await (await handler(req('as-web.lvh.me'))).text()
    expect(html).toContain('waking up')
    expect(html).toContain('data-p7y-waiting')
  })
})
