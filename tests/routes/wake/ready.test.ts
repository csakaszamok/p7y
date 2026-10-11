import { describe, it, expect, vi } from 'vitest'

const appReady = vi.fn(async (host: string) => host === 'shop-redmine.lvh.me' ? { ready: false, service: 'redmine' } : { ready: null })
vi.mock('../../../services/appReady', () => ({ appReady }))
const { default: handler } = await import('../../../routes/wake/ready/GET')

describe('GET /wake/ready', () => {
  it("whether the address's app answers, for the waiting page on the sandbox's own host (CORS, no credentials)", async () => {
    const res = await handler(new Request('http://localhost/wake/ready?host=shop-redmine.lvh.me'))
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ ready: false, service: 'redmine' })
  })
  it('without a host: 400', async () => {
    expect((await handler(new Request('http://localhost/wake/ready'))).status).toBe(400)
  })
})
