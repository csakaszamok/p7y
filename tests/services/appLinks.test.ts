import { describe, it, expect, vi, beforeEach } from 'vitest'
import { publicAppNames, appLinks, forgetAppLinks } from '../../services/appLinks'
import type { InnerContainer } from '../../services/tcpNames'

const ct = (name: string, ports: Array<[string, number]>, labels: Record<string, string> = {}): InnerContainer => ({
  Names: [`/${name}`], Labels: { 'com.docker.compose.project': 'inner', 'com.docker.compose.service': name, ...labels },
  Ports: ports.map(([IP, PublicPort]) => ({ IP, PublicPort, PrivatePort: PublicPort, Type: 'tcp' })),
})

describe('publicAppNames', () => {
  it('names only the ports published on all interfaces', () => {
    const names = publicAppNames('shop', [
      ct('web', [['0.0.0.0', 8080], ['::', 8080]]),
      ct('hermes', [['127.0.0.1', 9119]]),
      ct('db', [['', 5432]]),
      ct('lan', [['10.0.0.5', 7000]]),
    ])
    expect([...names]).toEqual([['shop-inner-web-port8080', { port: 8080, service: 'web' }], ['shop-inner-db-port5432', { port: 5432, service: 'db' }]])
  })

  it('keeps a frpc.subdomain name when the container has at least one public port', () => {
    expect([...publicAppNames('shop', [ct('portainer', [['127.0.0.1', 9443], ['0.0.0.0', 9000]], { 'frpc.subdomain': 'portainer' })])]).toEqual([['shop-portainer', { port: 9000, service: 'portainer' }]])
    expect([...publicAppNames('shop', [ct('portainer', [['127.0.0.1', 9000]], { 'frpc.subdomain': 'portainer' })])]).toEqual([])
  })

  it('names an app without a compose service by its container name', () => {
    const plain: InnerContainer = { Names: ['/hermes'], Labels: {}, Ports: [{ IP: '0.0.0.0', PublicPort: 9119, PrivatePort: 9119, Type: 'tcp' }] }
    expect([...publicAppNames('shop', [plain])]).toEqual([['shop-hermes-port9119', { port: 9119, service: 'hermes' }]])
  })
})

describe('appLinks', () => {
  beforeEach(() => forgetAppLinks())
  const deps = (containers: InnerContainer[] | Error, domains = ['shop-inner-web-port8080.lvh.me', 'shop-inner-hermes-port9119.lvh.me', 'Shop-Portainer.LVH.me']) => {
    let t = 0
    return {
      domains: vi.fn(async () => domains),
      containers: vi.fn(async () => { if (containers instanceof Error) throw containers; return containers }),
      instance: () => 'shop',
      now: () => t,
      tick: (ms: number) => { t += ms },
    }
  }

  it('keeps what frps serves only for public ports (case-insensitive, by the first label)', async () => {
    const d = deps([ct('web', [['0.0.0.0', 8080]]), ct('hermes', [['127.0.0.1', 9119]]), ct('portainer', [['', 9000]], { 'frpc.subdomain': 'portainer' })])
    expect(await appLinks('p7y-shop', d)).toEqual([{ url: 'shop-inner-web-port8080.lvh.me', port: 8080, service: 'web' }, { url: 'Shop-Portainer.LVH.me', port: 9000, service: 'portainer' }])
  })

  it('shows no link when the inner Docker cannot be asked', async () => {
    expect(await appLinks('p7y-shop', deps(new Error('connect ECONNREFUSED')))).toEqual([])
  })

  // createSandbox filters what it saw itself: a list poll's earlier (empty) answer must not stand in for it
  it('filters given domains afresh, whatever is cached', async () => {
    await appLinks('p7y-shop', deps([]))
    const d = deps([ct('web', [['0.0.0.0', 8080]])])
    expect(await appLinks('p7y-shop', d, ['shop-inner-web-port8080.lvh.me'])).toEqual([{ url: 'shop-inner-web-port8080.lvh.me', port: 8080, service: 'web' }])
  })

  it('asks again only after 10 s', async () => {
    const d = deps([ct('web', [['0.0.0.0', 8080]])])
    await appLinks('p7y-shop', d); d.tick(9_000); await appLinks('p7y-shop', d)
    expect(d.containers).toHaveBeenCalledTimes(1)
    d.tick(1_500); await appLinks('p7y-shop', d)
    expect(d.containers).toHaveBeenCalledTimes(2)
  })
})
