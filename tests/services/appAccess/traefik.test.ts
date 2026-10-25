import { describe, it, expect } from 'vitest'
import { traefikAccessConfig, refreshRunningLinks } from '../../../services/appAccess/traefik'


describe('the middlewares Traefik reads', () => {
  it('a middleware for every sandbox: a no-op when all its apps are public, forwardAuth otherwise', () => {
    const cfg = traefikAccessConfig({
      sandboxes: () => ['p9m-a', 'p9m-b', 'p9m-c'],
      access: (n: string): Record<string, 'public' | 'domain' | 'owner'> | null => n === 'p9m-a' ? { a: 'public' as const } : n === 'p9m-b' ? { b1: 'public' as const, b2: 'owner' as const } : null,
    })
    expect(cfg.http.middlewares['access-p9m-a']).toEqual({ headers: { customRequestHeaders: { 'X-P9m-User': '' } } })
    expect(cfg.http.middlewares['access-p9m-b']).toEqual({ forwardAuth: { address: 'http://p9m:3001/auth/app', trustForwardHeader: true, authResponseHeaders: ['X-P9m-User', 'Cookie'] } })
    // Never seen running (just created): forwardAuth until its labels are known, never open by not knowing
    expect(cfg.http.middlewares['access-p9m-c']).toHaveProperty('forwardAuth')
  })
  // Review Focus 1: a new owner-only label reaches Traefik's answer after one refresh of the running sandboxes
  it('refreshRunningLinks reads the links of the running sandboxes only', async () => {
    const asked: string[] = []
    await refreshRunningLinks({ running: async () => ['p9m-a', 'p9m-a', 'p9m-b'], links: async n => { asked.push(n); return [] } })
    expect(asked).toEqual(['p9m-a', 'p9m-b'])
  })
})

describe('GET /traefik/access', () => {
  it('answers Traefik on the internal network; through Traefik (X-Forwarded-For): 404', async () => {
    const get = (await import('../../../routes/traefik/access/GET')).default
    expect((await get(new Request('http://p9m:3000/traefik/access', { headers: { 'x-forwarded-for': '1.2.3.4' } }))).status).toBe(404)
    const res = await get(new Request('http://p9m:3000/traefik/access'))
    expect(res.status).toBe(200)
    expect(await res.json()).toHaveProperty('http.middlewares')
  })
})
