import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubEnv('SESSION_SECRET', 'test-secret')
vi.stubEnv('ADMIN_TOKEN', 'admin-secret')

const sandboxes = [
  { name: 'leander-a1', owner: 'alice@example.com', status: 'running', template: 't', container_id: '1', created_at: '', tunnel_urls: [], ssh: true },
  { name: 'leander-a2', owner: 'alice@example.com', status: 'running', template: 't', container_id: '3', created_at: '', tunnel_urls: [] },
  { name: 'leander-b1', owner: 'bob@example.com', status: 'running', template: 't', container_id: '2', created_at: '', tunnel_urls: [] }
]

vi.mock('../../../services/sandbox', () => ({
  sandboxService: {
    listSandboxes: vi.fn(async () => sandboxes),
    getSandbox: vi.fn(async (name: string) => {
      const s = sandboxes.find(x => x.name === name)
      if (!s) throw new Error(`Sandbox not found: ${name}`)
      return { ...s, ca_cert: '', client_cert: '', client_key: '', extras: {} }
    }),
    refreshStatus: vi.fn(async (name: string) => ({ name })),
    stopSandbox: vi.fn(async () => {}),
    startSandbox: vi.fn(async () => {}),
    restartSandbox: vi.fn(async () => {}),
    archiveSandbox: vi.fn(async () => '/opt/archive/x')
  }
}))
vi.mock('../../../services/resourceSettings', () => ({ limitsOf: vi.fn(() => ({ cpus: 2, memory: 4 * 1024 ** 3 })) }))
vi.mock('../../../services/usageSampler', () => ({ usageOf: vi.fn(() => ({ cpu: 0.5, memory: 1024, memory_limit: 4096 })) }))
vi.mock('../../../services/sandboxSsh', () => ({ sshKeyCount: vi.fn(() => 2), hasGeneratedKey: vi.fn(() => true) }))
vi.mock('../../../services/deepSleep', () => ({ deepSleepNow: vi.fn(async () => {}) }))
vi.mock('../../../services/tcpNames', () => ({
  publicTcpPorts: vi.fn(async (name: string) => [{ host: `${name}-db-port5432-tcp.lvh.me`, port: 15432, privatePort: 5432, user: 'app' }])
}))
vi.mock('../../../services/composeView', () => ({
  starterStack: vi.fn((name: string) => `services: # ${name}\n  portainer: {}`)
}))
vi.mock('../../../services/tokens', () => ({
  resolveToken: vi.fn((t: string) =>
    t === 'p7y_a1' ? { owner: 'alice@example.com', sandbox: 'leander-a1' }
    // alice's token for a name that is now bob's (her sandbox was deleted, bob took the name)
    : t === 'p7y_b1' ? { owner: 'alice@example.com', sandbox: 'leander-b1' }
    : null)
}))
vi.mock('../../../services/sleepTimes', () => ({
  sleepTimes: vi.fn(async () => ({ stops_at: '2026-09-27T13:30:00.000Z', deep_sleep_at: null, deep_sleep_after: '7d' })),
  sleepTimesMany: vi.fn(async (names: string[]) => new Map(names.map(n => [n, { stops_at: null, deep_sleep_at: `${n}-deep`, deep_sleep_after: '7d' }])))
}))

const { createSession } = await import('../../../services/session')
const { sandboxService } = await import('../../../services/sandbox')
const list = (await import('../../../routes/sandboxes/GET')).default
const get = (await import('../../../routes/sandboxes/[name]/GET')).default
const del = (await import('../../../routes/sandboxes/[name]/DELETE')).default
const stop = (await import('../../../routes/sandboxes/[name]/stop/POST')).default
const start = (await import('../../../routes/sandboxes/[name]/start/POST')).default
const restart = (await import('../../../routes/sandboxes/[name]/restart/POST')).default
const deepSleep = (await import('../../../routes/sandboxes/[name]/deep-sleep/POST')).default
const { deepSleepNow } = await import('../../../services/deepSleep')
const compose = (await import('../../../routes/sandboxes/[name]/compose/GET')).default

const alice = { cookie: `p7y_session=${createSession('alice@example.com', 'user')}`, origin: 'http://p7y.lvh.me', host: 'p7y.lvh.me' }
const r = (path: string, method = 'GET', headers: Record<string, string> = alice) =>
  new Request(`http://p7y.lvh.me${path}`, { method, headers })

describe('sandbox ownership', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists only the caller’s sandboxes; the admin sees all', async () => {
    expect((await (await list(r('/sandboxes'))).json()).map((s: { name: string }) => s.name)).toEqual(['leander-a1', 'leander-a2'])
    const all = await list(r('/sandboxes', 'GET', { authorization: 'Bearer admin-secret' }))
    expect((await all.json()).length).toBe(3)
  })

  it('adds sleep times to each listed row, asking only about the caller’s own sandboxes', async () => {
    const { sleepTimesMany } = await import('../../../services/sleepTimes')
    vi.mocked(sleepTimesMany).mockClear()
    const rows = await (await list(r('/sandboxes'))).json()
    expect(rows).toEqual([
      expect.objectContaining({ name: 'leander-a1', stops_at: null, deep_sleep_at: 'leander-a1-deep', deep_sleep_after: '7d', idle_timeout: null }),
      expect.objectContaining({ name: 'leander-a2' }),
    ])
    expect(sleepTimesMany).toHaveBeenCalledWith(['leander-a1', 'leander-a2'])
  })

  it('answers 404 for someone else’s sandbox on every route, without acting', async () => {
    expect((await get(r('/sandboxes/leander-b1'))).status).toBe(404)
    expect((await del(r('/sandboxes/leander-b1', 'DELETE'))).status).toBe(404)
    expect((await stop(r('/sandboxes/leander-b1/stop', 'POST'))).status).toBe(404)
    expect((await start(r('/sandboxes/leander-b1/start', 'POST'))).status).toBe(404)
    expect((await restart(r('/sandboxes/leander-b1/restart', 'POST'))).status).toBe(404)
    expect(sandboxService.archiveSandbox).not.toHaveBeenCalled()
    expect(sandboxService.stopSandbox).not.toHaveBeenCalled()
  })

  it('includes the sleep countdown in the owner’s sandbox details, and asks nothing for a foreign one', async () => {
    const { sleepTimes } = await import('../../../services/sleepTimes')
    const body = await (await get(r('/sandboxes/leander-a1'))).json()
    expect(body).toMatchObject({ name: 'leander-a1', stops_at: '2026-09-27T13:30:00.000Z', deep_sleep_at: null, deep_sleep_after: '7d' })
    vi.mocked(sleepTimes).mockClear()
    expect((await get(r('/sandboxes/leander-b1'))).status).toBe(404)
    expect(sleepTimes).not.toHaveBeenCalled()
  })

  it('lists the TLS TCP addresses of a running sandbox', async () => {
    const body = await (await get(r('/sandboxes/leander-a1'))).json()
    expect(body.tcp_urls).toEqual(['leander-a1-db-port5432-tcp.lvh.me:443'])
    expect(body.tcp_addresses).toEqual([{ address: 'leander-a1-db-port5432-tcp.lvh.me:443', port: 5432, user: 'app' }])
    expect(body.limits).toEqual({ cpus: 2, memory: 4 * 1024 ** 3 })
    expect(body.usage).toEqual({ cpu: 0.5, memory: 1024, memory_limit: 4096 })
  })

  it('gives the SSH address of a sandbox created with SSH, and null for one created before', async () => {
    const body = await (await get(r('/sandboxes/leander-a1'))).json()
    expect(body.ssh).toEqual({ address: 'a1-shell-tcp.lvh.me:443', user: 'root', keys: 2, generated_key: true })
    expect((await (await get(r('/sandboxes/leander-a2'))).json()).ssh).toBeNull()
  })

  it('lets the owner act on their own sandbox', async () => {
    expect((await stop(r('/sandboxes/leander-a1/stop', 'POST'))).status).toBe(200)
    expect(sandboxService.stopSandbox).toHaveBeenCalledWith('leander-a1')
  })

  it('401s anonymous callers', async () => {
    expect((await list(r('/sandboxes', 'GET', {}))).status).toBe(401)
    expect((await get(r('/sandboxes/leander-a1', 'GET', {}))).status).toBe(401)
  })
})

describe('sandbox-scoped token', () => {
  beforeEach(() => vi.clearAllMocks())
  const a1 = { authorization: 'Bearer p7y_a1', host: 'p7y.lvh.me' }

  it('lists and opens only its own sandbox, even though the owner has more', async () => {
    expect((await (await list(r('/sandboxes', 'GET', a1))).json()).map((s: { name: string }) => s.name)).toEqual(['leander-a1'])
    expect((await get(r('/sandboxes/leander-a1', 'GET', a1))).status).toBe(200)
    expect((await get(r('/sandboxes/leander-a2', 'GET', a1))).status).toBe(404)
    expect((await stop(r('/sandboxes/leander-a2/stop', 'POST', a1))).status).toBe(404)
    expect(sandboxService.stopSandbox).not.toHaveBeenCalled()
  })

  it('can start, stop and restart its sandbox but not delete it', async () => {
    expect((await stop(r('/sandboxes/leander-a1/stop', 'POST', a1))).status).toBe(200)
    expect((await start(r('/sandboxes/leander-a1/start', 'POST', a1))).status).toBe(200)
    expect((await restart(r('/sandboxes/leander-a1/restart', 'POST', a1))).status).toBe(200)
    expect((await del(r('/sandboxes/leander-a1', 'DELETE', a1))).status).toBe(403)
    expect(sandboxService.archiveSandbox).not.toHaveBeenCalled()
  })

  it('does not reach another user’s sandbox that took the same name', async () => {
    const b1 = { authorization: 'Bearer p7y_b1', host: 'p7y.lvh.me' }
    expect((await get(r('/sandboxes/leander-b1', 'GET', b1))).status).toBe(404)
    expect(await (await list(r('/sandboxes', 'GET', b1))).json()).toEqual([])
  })
})

describe('POST /sandboxes/:name/deep-sleep', () => {
  beforeEach(() => vi.clearAllMocks())

  it('puts the owner’s sandbox into deep sleep', async () => {
    const res = await deepSleep(r('/sandboxes/leander-a1/deep-sleep', 'POST'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'deep_sleep', name: 'leander-a1' })
    expect(deepSleepNow).toHaveBeenCalledWith('leander-a1')
  })

  it('404s someone else’s sandbox without acting, and 401s anonymous callers', async () => {
    expect((await deepSleep(r('/sandboxes/leander-b1/deep-sleep', 'POST'))).status).toBe(404)
    expect((await deepSleep(r('/sandboxes/leander-a1/deep-sleep', 'POST', {}))).status).toBe(401)
    expect(deepSleepNow).not.toHaveBeenCalled()
  })

  it('a token limited to the sandbox may do it', async () => {
    const a1 = { authorization: 'Bearer p7y_a1', host: 'p7y.lvh.me' }
    expect((await deepSleep(r('/sandboxes/leander-a1/deep-sleep', 'POST', a1))).status).toBe(200)
    expect((await deepSleep(r('/sandboxes/leander-a2/deep-sleep', 'POST', a1))).status).toBe(404)
  })
})

describe('GET /sandboxes/:name/compose', () => {
  it('gives the owner the starter stack deployed into the sandbox, and nothing of the sandbox’s own compose file', async () => {
    const res = await compose(r('/sandboxes/leander-a1/compose'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ starter: 'services: # leander-a1\n  portainer: {}' })
  })

  it('404s someone else’s sandbox and 401s anonymous callers', async () => {
    expect((await compose(r('/sandboxes/leander-b1/compose'))).status).toBe(404)
    expect((await compose(r('/sandboxes/leander-a1/compose', 'GET', {}))).status).toBe(401)
  })

  it('a token limited to the sandbox may read it, but not another sandbox’s', async () => {
    const a1 = { authorization: 'Bearer p7y_a1', host: 'p7y.lvh.me' }
    expect((await compose(r('/sandboxes/leander-a1/compose', 'GET', a1))).status).toBe(200)
    expect((await compose(r('/sandboxes/leander-a2/compose', 'GET', a1))).status).toBe(404)
  })
})
