import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import { publicAppNames, appLinks, forgetAppLinks, rememberedApps } from '../../services/appLinks'
import { forgetSandboxDir } from '../../services/sandboxPaths'
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
      remember: vi.fn(),
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

describe('apps remembered for a sleeping sandbox', () => {
  beforeEach(() => forgetAppLinks())
  const d = (containers: InnerContainer[] | Error, domains: string[]) => ({
    domains: async () => domains,
    containers: async () => { if (containers instanceof Error) throw containers; return containers },
    instance: () => 'shop', now: () => 0, remember: vi.fn(),
  })

  it('remembers the links a running sandbox answered with', async () => {
    const deps = d([ct('web', [['0.0.0.0', 8080]])], ['shop-inner-web-port8080.lvh.me'])
    await appLinks('p7y-shop', deps)
    expect(deps.remember).toHaveBeenCalledWith('p7y-shop', [{ url: 'shop-inner-web-port8080.lvh.me', port: 8080, service: 'web' }])
  })

  it('keeps what it had when frps has nothing yet (just woken) or the inner Docker does not answer', async () => {
    const none = d([ct('web', [['0.0.0.0', 8080]])], [])
    await appLinks('p7y-shop', none)
    const down = d(new Error('connect ECONNREFUSED'), ['shop-inner-web-port8080.lvh.me'])
    forgetAppLinks(); await appLinks('p7y-shop', down)
    expect(none.remember).not.toHaveBeenCalled()
    expect(down.remember).not.toHaveBeenCalled()
  })

  it('reads back what was remembered, in the sandbox directory', async () => {
    const dir = `${process.env.SANDBOXES_DIR}/admin/p7y-rem`
    fs.mkdirSync(dir, { recursive: true })
    forgetSandboxDir()
    try {
      expect(rememberedApps('p7y-rem')).toBeNull()
      const { remember: _, ...deps } = d([ct('web', [['0.0.0.0', 8080]]), ct('api', [['0.0.0.0', 3000]])], ['shop-inner-web-port8080.lvh.me', 'shop-inner-api-port3000.lvh.me'])
      await appLinks('p7y-rem', deps)
      expect(rememberedApps('p7y-rem')).toEqual([{ url: 'shop-inner-web-port8080.lvh.me', port: 8080, service: 'web' }, { url: 'shop-inner-api-port3000.lvh.me', port: 3000, service: 'api' }])
    } finally { fs.rmSync(dir, { recursive: true, force: true }); forgetSandboxDir() }
  })
})
