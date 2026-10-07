import { describe, it, expect, vi } from 'vitest'
import { portainerAccess, type PortainerCall } from '../../services/portainerToken'

const URL_ = 'https://shop-portainer.lvh.me'
const sandbox = (over: Record<string, unknown> = {}) => ({
  name: 'p7y-shop', status: 'running', tunnel_urls: ['shop-portainer.lvh.me', 'shop-web.lvh.me'],
  extras: { portainer_url: URL_, portainer_password: 'pw' }, ...over,
})

/** A Portainer that answers like 2.21: status, auth, users/me, tokens. */
function fakePortainer(opts: { waitingFor?: number; password?: string } = {}) {
  let waiting = opts.waitingFor ?? 0
  const calls: Array<{ host: string; method: string; path: string; body?: unknown; headers?: Record<string, string> }> = []
  const call: PortainerCall = async (host, method, path, o = {}) => {
    calls.push({ host, method, path, body: o.body, headers: o.headers })
    if (path === '/api/status') {
      if (waiting > 0) { waiting--; return { status: 200, text: '<html>Sandbox is waking up</html>' } }
      return { status: 200, text: '{"Version":"2.21.5"}' }
    }
    if (path === '/api/auth') {
      const b = o.body as { username: string; password: string }
      return b.password === (opts.password ?? 'pw') ? { status: 200, text: '{"jwt":"J"}' } : { status: 422, text: '{"message":"Invalid credentials"}' }
    }
    if (path === '/api/users/me') return { status: 200, text: '{"Id":7,"Username":"admin"}' }
    if (path === '/api/users/7/tokens') return { status: 200, text: '{"rawAPIKey":"ptr_abc","apiKey":{"id":3}}' }
    return { status: 404, text: '' }
  }
  return { call, calls }
}

const fast = { deadlineMs: 2000, retryMs: 1 }

describe('portainerAccess', () => {
  it('makes an API token as the sandbox admin: no password goes to the agent', async () => {
    const p = fakePortainer()
    const wake = vi.fn(async () => {})
    const got = await portainerAccess(sandbox(), 'p7y: laptop agent', { call: p.call, wake, ...fast })
    expect(got).toEqual({ url: URL_, token: 'ptr_abc' })
    expect(wake).not.toHaveBeenCalled()
    expect(p.calls.every(c => c.host === 'shop-portainer.lvh.me')).toBe(true)
    expect(p.calls.find(c => c.path === '/api/auth')!.body).toEqual({ username: 'admin', password: 'pw' })
    const tok = p.calls.find(c => c.path === '/api/users/7/tokens')!
    expect(tok.method).toBe('POST')
    expect(tok.body).toEqual({ description: 'p7y: laptop agent', password: 'pw' })
    expect(tok.headers).toEqual({ Authorization: 'Bearer J' })
  })

  it('wakes an asleep sandbox and waits through the waiting page', async () => {
    const p = fakePortainer({ waitingFor: 3 })
    const wake = vi.fn(async () => {})
    const got = await portainerAccess(sandbox({ status: 'exited' }), 'x', { call: p.call, wake, ...fast })
    expect(wake).toHaveBeenCalledWith('p7y-shop')
    expect(got).toEqual({ url: URL_, token: 'ptr_abc' })
  })

  it('skips a private Portainer (published on 127.0.0.1) without calling it', async () => {
    const p = fakePortainer()
    const got = await portainerAccess(sandbox({ tunnel_urls: ['shop-web.lvh.me'] }), 'x', { call: p.call, wake: async () => {}, ...fast })
    expect(got).toEqual({ skipped: expect.stringMatching(/private/) })
    expect(p.calls).toEqual([])
  })

  it('skips a sandbox without Portainer', async () => {
    const got = await portainerAccess(sandbox({ extras: {} }), 'x', { call: fakePortainer().call, wake: async () => {}, ...fast })
    expect(got).toEqual({ skipped: expect.stringMatching(/no Portainer/) })
  })

  it('skips when the stored password no longer works', async () => {
    const got = await portainerAccess(sandbox(), 'x', { call: fakePortainer({ password: 'changed' }).call, wake: async () => {}, ...fast })
    expect(got).toEqual({ skipped: expect.stringMatching(/password/) })
  })

  it('skips when Portainer does not answer in time, or the wake fails', async () => {
    const slow = await portainerAccess(sandbox(), 'x', { call: fakePortainer({ waitingFor: 1e9 }).call, wake: async () => {}, deadlineMs: 20, retryMs: 1 })
    expect(slow).toEqual({ skipped: expect.stringMatching(/did not answer/) })
    const broken = await portainerAccess(sandbox({ status: 'deep_sleep' }), 'x', { call: fakePortainer().call, wake: async () => { throw new Error('compose up failed') }, ...fast })
    expect(broken).toEqual({ skipped: expect.stringMatching(/compose up failed/) })
  })
})
