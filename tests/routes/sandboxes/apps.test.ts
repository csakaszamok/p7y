import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
vi.mock('../../../services/sandbox', () => ({
  sandboxService: {
    getSandbox: vi.fn(async (n: string) => ({
      name: n, owner: 'admin', status: n === 'p7y-up' ? 'running' : 'exited', template: 't', created_at: '', extras: {},
      tunnel_urls: n === 'p7y-up' ? ['up-inner-web-port8080.lvh.me'] : ['down-inner-web-port8080.lvh.me'],
      ...(n === 'p7y-up' ? {} : { app_services: { 'down-inner-web-port8080.lvh.me': 'web' } }),
    })),
  },
}))
vi.mock('../../../services/sleepTimes', () => ({ sleepTimes: vi.fn(async () => ({})) }))
vi.mock('../../../services/sleepSettings', () => ({ sleepSettingsOf: vi.fn(() => ({})) }))
vi.mock('../../../services/tcpNames', () => ({
  publicTcpPorts: vi.fn(async () => []),
  rememberedTcpPorts: vi.fn((n: string) => n === 'p7y-down' ? [{ host: 'down-db-tcp.lvh.me', port: 5432, privatePort: 5432, user: 'postgres' }] : null),
}))
vi.mock('../../../services/sandboxSsh', () => ({ sshKeyCount: vi.fn(() => 0), hasGeneratedKey: vi.fn(() => false) }))
vi.mock('../../../services/resourceSettings', () => ({ limitsOf: vi.fn(() => null) }))
vi.mock('../../../services/usageSampler', () => ({ usageOf: vi.fn(() => null) }))
vi.mock('../../../services/diskUsage', () => ({ diskOf: vi.fn(() => null) }))
vi.mock('../../../services/appLinks', () => ({
  appLinks: vi.fn(async () => [{ url: 'up-inner-web-port8080.lvh.me', port: 8080, service: 'web' }]),
  // What it had when it last ran: its p7y.access
  rememberedApps: vi.fn((n: string) => n === 'p7y-down' ? [{ url: 'down-inner-web-port8080.lvh.me', port: 8080, service: 'web', access: 'owner' }] : null),
}))
vi.mock('../../../services/appProbe', () => ({
  appStatuses: vi.fn(async (_n: string, links: Array<{ url: string; port: number }>) => links.map(l => ({ ...l, answers: false }))),
}))
vi.mock('../../../services/hub/list', () => ({
  // A running sandbox is read live (refreshHub), so the marker is right without anyone opening the Hub
  refreshHub: vi.fn(async (n: string) => n === 'p7y-up'
    ? { apps: [{ id: 'up-inner-web-port8080.lvh.me', url: 'http://up-inner-web-port8080.lvh.me', title: 'Web', description: '', service: 'web', updated_at: '' }], unlinked: ['worker'] }
    : null),
  rememberedHub: vi.fn((n: string) => n === 'p7y-up' ? null : n === 'p7y-up-never'
    ? { apps: [{ id: 'up-inner-web-port8080.lvh.me', url: 'http://up-inner-web-port8080.lvh.me', title: 'Web', description: '', service: 'web', updated_at: '' }], unlinked: ['worker'] }
    : null),
}))
vi.mock('../../../services/lastRunning', () => ({
  lastRunningOf: vi.fn(async (_n: string, status: string) => status === 'running' ? { at: null, estimated: false } : { at: '2026-09-01T08:00:00.000Z', estimated: true }),
}))
const { appStatuses } = await import('../../../services/appProbe')
const { default: get } = await import('../../../routes/sandboxes/[name]/GET')
const req = (n: string) => new Request(`http://localhost/sandboxes/${n}`, { headers: { Authorization: 'Bearer admin-secret' } })

describe('GET /sandboxes/:name apps', () => {
  it('a running sandbox: each link with whether its app answers', async () => {
    const body = await (await get(req('p7y-up'))).json()
    expect(body.apps).toEqual([{ url: 'up-inner-web-port8080.lvh.me', port: 8080, service: 'web', answers: false }])
    expect(body.tunnel_urls).toEqual(['up-inner-web-port8080.lvh.me'])
  })

  it('a sandbox that is not running: links unmeasured, and nothing is probed', async () => {
    vi.mocked(appStatuses).mockClear()
    const body = await (await get(req('p7y-down'))).json()
    expect(body.apps).toEqual([{ url: 'down-inner-web-port8080.lvh.me', port: null, service: 'web', answers: null, access: 'owner' }])
    expect(body).not.toHaveProperty('app_services')
    expect(appStatuses).not.toHaveBeenCalled()
  })

  // A connection wakes it, so its TCP addresses are shown asleep too: those it had when it last ran
  it('a sandbox that is not running: the TCP addresses it had when it last ran', async () => {
    const body = await (await get(req('p7y-down'))).json()
    expect(body.tcp_addresses).toEqual([{ address: 'down-db-tcp.lvh.me:443', port: 5432, user: 'postgres' }])
    expect(body.tcp_urls).toEqual(['down-db-tcp.lvh.me:443'])
  })
})

describe('GET /sandboxes/:name hub', () => {
  it('says which apps are on the Hub and which published ones have no web address', async () => {
    vi.stubEnv('HUB_ENABLED', 'true')
    const body = await (await get(req('p7y-up'))).json()
    expect(body.hub).toEqual({ enabled: true, url: 'http://hub.lvh.me', published: ['up-inner-web-port8080.lvh.me'], unlinked: ['worker'], bad_image: [], owner_only: [] })
    vi.stubEnv('HUB_ENABLED', 'false')
    expect((await (await get(req('p7y-down'))).json()).hub).toEqual({ enabled: false, url: null, published: [], unlinked: [], bad_image: [], owner_only: [] })
  })
})

describe('GET /sandboxes/:name last running', () => {
  it('says when a sandbox that is not running last ran (and whether that is an estimate); nothing while it runs', async () => {
    const down = await (await get(req('p7y-down'))).json()
    expect(down).toMatchObject({ last_running_at: '2026-09-01T08:00:00.000Z', last_running_estimated: true })
    const up = await (await get(req('p7y-up'))).json()
    expect(up).toMatchObject({ last_running_at: null, last_running_estimated: false })
  })
})
