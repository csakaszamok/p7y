import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import { publicAppNames, appLinks, appLinksForView, forgetAppLinks, rememberedApps } from '../../services/appLinks'
import { forgetSandboxDir } from '../../services/sandboxPaths'
import type { InnerContainer } from '../../services/tcpNames'
// These apps carry no p9m.access label: as public ones (the default is owner; see appAccess/level.test.ts)
vi.stubEnv('APPS_ACCESS_DEFAULT', 'public')

const ct = (name: string, ports: Array<[string, number]>, labels: Record<string, string> = {}): InnerContainer => ({
  Names: [`/${name}`], Labels: { 'com.docker.compose.project': 'inner', 'com.docker.compose.service': name, ...labels },
  Ports: ports.map(([IP, PublicPort]) => ({ IP, PublicPort, PrivatePort: PublicPort, Type: 'tcp' })),
})

describe('publicAppNames', () => {
  it('each link carries its app access from p9m.access (invalid: owner, marked)', () => {
    const m = publicAppNames('shop', [
      ct('web', [['0.0.0.0', 8080]], { 'p9m.access': 'domain' }),
      ct('api', [['0.0.0.0', 9000]], { 'p9m.access': 'privat' }),
      ct('doc', [['0.0.0.0', 9001]]),
    ])
    expect([...m.values()].map(v => [v.service, v.access, v.access_invalid ?? false])).toEqual([
      ['web', 'domain', false], ['api', 'owner', true], ['doc', 'public', false],
    ])
  })
  it('names only the ports published on all interfaces', () => {
    const names = publicAppNames('shop', [
      ct('web', [['0.0.0.0', 8080], ['::', 8080]]),
      ct('hermes', [['127.0.0.1', 9119]]),
      ct('db', [['', 5432]]),
      ct('lan', [['10.0.0.5', 7000]]),
    ])
    expect([...names]).toEqual([['shop-inner-web-port8080', { port: 8080, service: 'web', project: 'inner', access: 'public' }], ['shop-inner-db-port5432', { port: 5432, service: 'db', project: 'inner', access: 'public' }]])
  })

  it('keeps a p9m.subdomain name when the container has at least one public port', () => {
    expect([...publicAppNames('shop', [ct('portainer', [['127.0.0.1', 9443], ['0.0.0.0', 9000]], { 'p9m.subdomain': 'portainer' })])]).toEqual([['shop-portainer', { port: 9000, service: 'portainer', project: 'inner', access: 'public' }]])
    expect([...publicAppNames('shop', [ct('portainer', [['127.0.0.1', 9000]], { 'p9m.subdomain': 'portainer' })])]).toEqual([])
  })

  it('names an app without a compose service by its container name', () => {
    const plain: InnerContainer = { Names: ['/hermes'], Labels: {}, Ports: [{ IP: '0.0.0.0', PublicPort: 9119, PrivatePort: 9119, Type: 'tcp' }] }
    expect([...publicAppNames('shop', [plain])]).toEqual([['shop-hermes-port9119', { port: 9119, service: 'hermes', access: 'public' }]])
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
      rememberAccess: vi.fn(),
    }
  }

  it('keeps what frps serves only for public ports (case-insensitive, by the first label)', async () => {
    const d = deps([ct('web', [['0.0.0.0', 8080]]), ct('hermes', [['127.0.0.1', 9119]]), ct('portainer', [['', 9000]], { 'p9m.subdomain': 'portainer' })])
    expect(await appLinks('p9m-shop', d)).toEqual([{ url: 'shop-inner-web-port8080.lvh.me', port: 8080, service: 'web', project: 'inner', access: 'public' }, { url: 'Shop-Portainer.LVH.me', port: 9000, service: 'portainer', project: 'inner', access: 'public' }])
  })

  it('shows no link when the inner Docker cannot be asked', async () => {
    expect(await appLinks('p9m-shop', deps(new Error('connect ECONNREFUSED')))).toEqual([])
  })

  // createSandbox filters what it saw itself: a list poll's earlier (empty) answer must not stand in for it
  it('filters given domains afresh, whatever is cached', async () => {
    await appLinks('p9m-shop', deps([]))
    const d = deps([ct('web', [['0.0.0.0', 8080]])])
    expect(await appLinks('p9m-shop', d, ['shop-inner-web-port8080.lvh.me'])).toEqual([{ url: 'shop-inner-web-port8080.lvh.me', port: 8080, service: 'web', project: 'inner', access: 'public' }])
  })

  // App access: every app's level from its container's labels, also before frps registers it (no partial knowledge)
  it('remembers the level of every app from the labels, whatever frps serves yet', async () => {
    const remembered: Array<Record<string, string>> = []
    const d = { ...deps([ct('web', [['0.0.0.0', 8080]]), ct('own', [['0.0.0.0', 8081]], { 'p9m.access': 'owner' })]), rememberAccess: (_n: string, m: Record<string, string>) => { remembered.push(m) } }
    d.domains = vi.fn(async () => ['shop-inner-web-port8080.lvh.me']) // only web registered so far
    await appLinks('p9m-shop', d)
    expect(remembered).toEqual([{ 'shop-inner-web-port8080': 'public', 'shop-inner-own-port8081': 'owner' }])
  })

  // Right after a create or a wake frps has no proxy yet: the next ask must see the app as soon as it registers
  it('does not keep an empty answer', async () => {
    const d = deps([])
    await appLinks('p9m-shop', d); d.tick(1_000); await appLinks('p9m-shop', d)
    expect(d.containers).toHaveBeenCalledTimes(2)
  })

  it('asks again only after 10 s', async () => {
    const d = deps([ct('web', [['0.0.0.0', 8080]])])
    await appLinks('p9m-shop', d); d.tick(9_000); await appLinks('p9m-shop', d)
    expect(d.containers).toHaveBeenCalledTimes(1)
    d.tick(1_500); await appLinks('p9m-shop', d)
    expect(d.containers).toHaveBeenCalledTimes(2)
  })

  // Every user's list and the access refresher ask at once: one read, not one each
  it('asks once for callers that ask while a read is under way', async () => {
    const d = deps([ct('web', [['0.0.0.0', 8080]])])
    const all = await Promise.all([appLinks('p9m-shop', d), appLinks('p9m-shop', d), appLinks('p9m-shop', d)])
    expect(d.containers).toHaveBeenCalledTimes(1)
    expect(all[1]).toEqual(all[0])
  })

  it('after no answer, asks again only after 2 s (each wait takes seconds)', async () => {
    const d = deps(new Error('timeout'))
    await appLinks('p9m-shop', d); d.tick(1_500); await appLinks('p9m-shop', d)
    expect(d.containers).toHaveBeenCalledTimes(1)
    d.tick(1_000); await appLinks('p9m-shop', d)
    expect(d.containers).toHaveBeenCalledTimes(2)
  })
})

describe('appLinksForView', () => {
  beforeEach(() => forgetAppLinks())
  const before = [{ url: 'shop-inner-web-port8080.lvh.me', port: 8080, service: 'web', access: 'public' as const }]
  const d = (containers: InnerContainer[] | Error, domains: string[] | Error = ['shop-inner-web-port8080.lvh.me']) => ({
    domains: async () => { if (domains instanceof Error) throw domains; return domains },
    containers: async () => { if (containers instanceof Error) throw containers; return containers },
    instance: () => 'shop', now: () => 0, remember: vi.fn(), rememberAccess: vi.fn(), recall: () => before,
  })

  it('what the sandbox answers, not stale', async () => {
    expect(await appLinksForView('p9m-shop', d([ct('web', [['0.0.0.0', 8080]])]))).toEqual({ links: [{ ...before[0], project: 'inner' }], stale: false })
  })

  it('a sandbox whose inner Docker or frps does not answer (a busy server): the apps it last had, stale', async () => {
    expect(await appLinksForView('p9m-shop', d(new Error('timeout')))).toEqual({ links: before, stale: true })
    forgetAppLinks()
    expect(await appLinksForView('p9m-shop', d([ct('web', [['0.0.0.0', 8080]])], new Error('frps of p9m-shop does not answer')))).toEqual({ links: before, stale: true })
  })

  // Just woken: frps answers, with no proxy yet. That is the truth, not a failure
  it('frps with no proxies yet is not stale', async () => {
    expect(await appLinksForView('p9m-shop', d([ct('web', [['0.0.0.0', 8080]])], []))).toEqual({ links: [], stale: false })
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
    await appLinks('p9m-shop', deps)
    expect(deps.remember).toHaveBeenCalledWith('p9m-shop', [{ url: 'shop-inner-web-port8080.lvh.me', port: 8080, service: 'web', project: 'inner', access: 'public' }])
  })

  it('keeps what it had when frps has nothing yet (just woken) or the inner Docker does not answer', async () => {
    const none = d([ct('web', [['0.0.0.0', 8080]])], [])
    await appLinks('p9m-shop', none)
    const down = d(new Error('connect ECONNREFUSED'), ['shop-inner-web-port8080.lvh.me'])
    forgetAppLinks(); await appLinks('p9m-shop', down)
    expect(none.remember).not.toHaveBeenCalled()
    expect(down.remember).not.toHaveBeenCalled()
  })

  it('reads back what was remembered, in the sandbox directory', async () => {
    const dir = `${process.env.SANDBOXES_DIR}/admin/p9m-rem`
    fs.mkdirSync(dir, { recursive: true })
    forgetSandboxDir()
    try {
      expect(rememberedApps('p9m-rem')).toBeNull()
      const { remember: _, ...deps } = d([ct('web', [['0.0.0.0', 8080]]), ct('api', [['0.0.0.0', 3000]])], ['shop-inner-web-port8080.lvh.me', 'shop-inner-api-port3000.lvh.me'])
      await appLinks('p9m-rem', deps)
      expect(rememberedApps('p9m-rem')).toEqual([{ url: 'shop-inner-web-port8080.lvh.me', port: 8080, service: 'web', project: 'inner', access: 'public' }, { url: 'shop-inner-api-port3000.lvh.me', port: 3000, service: 'api', project: 'inner', access: 'public' }])
    } finally { fs.rmSync(dir, { recursive: true, force: true }); forgetSandboxDir() }
  })
})
