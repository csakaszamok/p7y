import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sandboxMeta } from '../helpers/sandboxMeta'

vi.mock('../../services/docker', () => ({ listManagedContainers: vi.fn().mockResolvedValue([]) }))
vi.mock('../../services/compose', () => ({ composeUp: vi.fn(), composeStart: vi.fn() }))
let refusal: unknown = null
vi.mock('../../services/quota', () => ({ reserveWake: vi.fn(async () => (refusal ? { ok: false, refusal } : { ok: true, release: () => {} })) }))

vi.mock('../../services/sandboxPaths', async orig => (await import('../helpers/legacySandboxPaths')).legacySandboxPaths(orig))

let dirs: string[] = []
let certs = false
let composeText = 'traefik.http.routers.frps-x.entrypoints: web,websecure'
vi.mock('fs', async (orig) => {
  const actual = await orig<typeof import('fs')>()
  const mocked = {
    ...actual,
    existsSync: vi.fn((p: string) => p === '/opt/users' || dirs.some(d => p === `/opt/users/${d}/docker-compose.yml`) || (certs && (p === '/app/certs/tls.crt' || p === '/app/certs/tls.key'))),
    readdirSync: vi.fn(() => [...dirs, 'Bad..Name', 'other-thing']),
    readFileSync: vi.fn(() => composeText)
  }
  return { ...mocked, default: mocked }
})

// node:http.get / request mock: each call answers with the next queued { status, body }
const httpCalls: Array<{ hostname: string; headers: Record<string, string> }> = []
let httpAnswers: Array<{ status: number; body: string }> = []
vi.mock('node:http', async () => {
  const { EventEmitter } = await import('node:events')
  const get = (opts: { hostname: string; headers: Record<string, string> }, cb: (res: unknown) => void) => {
    httpCalls.push(opts)
    const answer = httpAnswers.shift() ?? { status: 404, body: 'frps 404' }
    const res = Object.assign(new EventEmitter(), { statusCode: answer.status, setEncoding: () => {} })
    const req = Object.assign(new EventEmitter(), { destroy: () => {}, end: () => {} })
    setImmediate(() => { cb(res); res.emit('data', answer.body); res.emit('end') })
    return req
  }
  // requestViaTraefik uses request(); same answers
  return { default: { get, request: get }, get, request: get }
})

// node:https.get mock (used once HTTPS is enabled)
const httpsCalls: Array<{ hostname: string; port: number; servername: string; rejectUnauthorized: boolean; headers: Record<string, string> }> = []
vi.mock('node:https', async () => {
  const { EventEmitter } = await import('node:events')
  const get = (opts: typeof httpsCalls[number], cb: (res: unknown) => void) => {
    httpsCalls.push(opts)
    const res = Object.assign(new EventEmitter(), { statusCode: 404, setEncoding: () => {} })
    const req = Object.assign(new EventEmitter(), { destroy: () => {}, end: () => {} })
    setImmediate(() => { cb(res); res.emit('data', 'frps 404'); res.emit('end') })
    return req
  }
  // requestViaTraefik uses request(); same answers
  return { default: { get, request: get }, get, request: get }
})

import { findSandboxDirByHost, wakeByHost } from '../../services/wake'
import { composeUp, composeStart } from '../../services/compose'
import { listManagedContainers } from '../../services/docker'

describe('findSandboxDirByHost', () => {
  beforeEach(() => { dirs = ['leander-a', 'leander-ab'] })

  it('matches the longest raw-name prefix, ignoring port and case', () => {
    expect(findSandboxDirByHost('ab-inner-web-port80.lvh.me')).toBe('leander-ab')
    expect(findSandboxDirByHost('a-portainer.lvh.me')).toBe('leander-a')
    expect(findSandboxDirByHost('AB-Inner-Web-Port80.LVH.ME:80')).toBe('leander-ab')
  })

  it('only accepts hosts the sandbox router would match (<raw>-<x>.<HOST_DOMAIN>)', () => {
    expect(findSandboxDirByHost('a.lvh.me')).toBeNull()              // bare raw name: no sandbox router
    expect(findSandboxDirByHost('ab-web.other-domain.com')).toBeNull() // foreign domain
    expect(findSandboxDirByHost('ab-web.sub.lvh.me')).toBeNull()      // extra label
    expect(findSandboxDirByHost('ab-.lvh.me')).toBeNull()             // empty suffix after raw-
  })

  it('finds new p7y- sandboxes next to legacy leander- ones', () => {
    dirs = ['leander-a', 'p7y-shop']
    expect(findSandboxDirByHost('shop-portainer.lvh.me')).toBe('p7y-shop')
    expect(findSandboxDirByHost('a-portainer.lvh.me')).toBe('leander-a')
  })

  it('returns null for unknown hosts and dirs without a compose file', () => {
    expect(findSandboxDirByHost('zzz-web.lvh.me')).toBeNull()
    expect(findSandboxDirByHost('')).toBeNull()
    dirs = []
    expect(findSandboxDirByHost('a-web.lvh.me')).toBeNull()
  })
})

describe('wakeByHost', () => {
  beforeEach(() => {
    vi.mocked(composeUp).mockReset()
    vi.mocked(listManagedContainers).mockResolvedValue([])
  })

  it('reports not_found for hosts without a sandbox', async () => {
    dirs = []
    expect(await wakeByHost('x-web.lvh.me')).toEqual({ result: 'not_found' })
  })

  it('starts compose up once while a wake is in progress', async () => {
    dirs = ['leander-w1']
    vi.mocked(composeUp).mockReturnValue(new Promise(() => {}))
    expect(await wakeByHost('w1-web.lvh.me')).toEqual({ result: 'started', name: 'leander-w1', from: 'deep_sleep' })
    // The waiting page reloads every 3 s: it keeps saying where the sandbox wakes from
    expect(await wakeByHost('w1-web.lvh.me')).toEqual({ result: 'in_progress', name: 'leander-w1', from: 'deep_sleep' })
    expect(composeUp).toHaveBeenCalledTimes(1)
    expect(composeUp).toHaveBeenCalledWith('/opt/users/leander-w1/docker-compose.yml')
  })

  it('lets the next request retry after compose up failed', async () => {
    dirs = ['leander-w2']
    vi.mocked(composeUp).mockRejectedValueOnce(new Error('pull failed')).mockReturnValue(new Promise(() => {}))
    expect((await wakeByHost('w2-web.lvh.me')).result).toBe('started')
    await vi.waitFor(async () => expect((await wakeByHost('w2-web.lvh.me')).result).toBe('started'))
    expect(composeUp).toHaveBeenCalledTimes(2)
  })

  it('opens a Sablier session through the sandbox router once compose up is done', { timeout: 10000 }, async () => {
    // Without a request through the Sablier middleware the woken sandbox has no
    // session and would never go back to sleep.
    dirs = ['leander-w4']
    httpCalls.length = 0
    httpAnswers = [
      { status: 200, body: '<div data-p7y-waiting><p>rebuilding after a long sleep</p></div>' }, // Traefik has not picked up the router yet
      { status: 404, body: 'frps: no such proxy' }                    // passed Sablier (session opened), frps 404
    ]
    vi.mocked(composeUp).mockResolvedValue(undefined)
    await wakeByHost('w4-web.lvh.me')
    await vi.waitFor(() => expect(httpCalls).toHaveLength(2), { timeout: 5000 })
    await new Promise(r => setTimeout(r, 1500))
    expect(httpCalls).toHaveLength(2) // stopped once through the sandbox router
    // fetch() cannot set Host, so this must be a raw http request with an explicit Host header
    expect(httpCalls[1].hostname).toBe('traefik')
    expect(httpCalls[1].headers).toEqual({ host: 'w4-p7y-wake.lvh.me' })
  })

  it('with HTTPS on, primes the session over HTTPS (plain HTTP is redirected before Sablier sees it)', { timeout: 10000 }, async () => {
    dirs = ['leander-w5']
    certs = true
    httpCalls.length = 0; httpsCalls.length = 0
    vi.mocked(composeUp).mockResolvedValue(undefined)
    try {
      await wakeByHost('w5-web.lvh.me')
      await vi.waitFor(() => expect(httpsCalls).toHaveLength(1), { timeout: 5000 })
      expect(httpsCalls[0]).toMatchObject({ hostname: 'traefik', port: 443, servername: 'w5-p7y-wake.lvh.me', rejectUnauthorized: false, headers: { host: 'w5-p7y-wake.lvh.me' } })
      expect(httpCalls).toHaveLength(0)
    } finally {
      certs = false
    }
  })

  it('treats a redirect as "not through the sandbox router yet" and retries', { timeout: 10000 }, async () => {
    dirs = ['leander-w6']
    httpCalls.length = 0
    httpAnswers = [{ status: 301, body: '' }, { status: 404, body: 'frps: no such proxy' }]
    vi.mocked(composeUp).mockResolvedValue(undefined)
    await wakeByHost('w6-web.lvh.me')
    await vi.waitFor(() => expect(httpCalls).toHaveLength(2), { timeout: 5000 })
  })

  it('with HTTPS on, reports a sandbox whose router predates HTTPS instead of waking it forever', async () => {
    dirs = ['leander-w7']
    certs = true
    composeText = 'traefik.http.routers.frps-leander-w7.entrypoints: web'
    vi.mocked(composeUp).mockClear()
    try {
      expect(await wakeByHost('w7-web.lvh.me')).toEqual({ result: 'outdated', name: 'leander-w7' })
      expect(composeUp).not.toHaveBeenCalled()
    } finally {
      certs = false
      composeText = 'traefik.http.routers.frps-x.entrypoints: web,websecure'
    }
  })

  it('does not start containers that already exist; right after its own wake it waits for the router', async () => {
    dirs = ['leander-w3']
    vi.mocked(composeUp).mockResolvedValue(undefined)
    expect((await wakeByHost('w3-web.lvh.me')).result).toBe('started')
    await vi.waitFor(() => expect(composeUp).toHaveBeenCalled())
    await new Promise(r => setImmediate(r))
    vi.mocked(listManagedContainers).mockResolvedValue([sandboxMeta({ name: 'leander-w3', template: 't', status: 'running', container_id: 'x', created_at: '' })])
    expect(await wakeByHost('w3-web.lvh.me')).toEqual({ result: 'in_progress', name: 'leander-w3', from: 'deep_sleep' })
    expect(composeUp).toHaveBeenCalledTimes(1)
  })

  it('reports no_route for existing containers it did not just wake: the request should have hit the sandbox router', async () => {
    // e.g. an https:// request to a sandbox whose router only listens on `web` — waking it would loop forever
    dirs = ['leander-w8']
    vi.mocked(listManagedContainers).mockResolvedValue([sandboxMeta({ name: 'leander-w8', template: 't', status: 'running', container_id: 'x', created_at: '' })])
    expect(await wakeByHost('w8-web.lvh.me')).toEqual({ result: 'no_route', name: 'leander-w8' })
    expect(composeUp).not.toHaveBeenCalled()
  })
})

describe('wakeByHost: every wake through p7y', () => {
  const lim = { reason: 'running', title: 'Running limit reached', message: 'Running limit reached: 1 running sandbox allowed, running now: shop. Put one to sleep first.', limit: 1, running: ['p7y-shop'] }
  beforeEach(() => { refusal = null; vi.mocked(composeUp).mockReset(); vi.mocked(composeStart).mockReset() })

  it('an asleep sandbox (its router is gone while it is stopped): starts it, from asleep', async () => {
    dirs = ['p7y-zz']
    vi.mocked(listManagedContainers).mockResolvedValue([sandboxMeta({ name: 'p7y-zz', owner: 'u@x', template: 't', status: 'exited', container_id: 'x', created_at: '' })] as never)
    vi.mocked(composeStart).mockReturnValue(new Promise(() => {}))
    expect(await wakeByHost('zz-web.lvh.me')).toEqual({ result: 'started', name: 'p7y-zz', from: 'asleep' })
    expect(composeStart).toHaveBeenCalledWith('/opt/users/p7y-zz/docker-compose.yml')
    expect(composeUp).not.toHaveBeenCalled()
  })

  it('at the limit: the refusal, nothing started', async () => {
    const { reserveWake } = await import('../../services/quota')
    dirs = ['p7y-lim']
    composeText = 'traefik.http.routers.frps-x.entrypoints: web,websecure\n      p7y.owner: "u@x"'
    vi.mocked(listManagedContainers).mockResolvedValue([])
    refusal = lim
    expect(await wakeByHost('lim-web.lvh.me')).toEqual({ result: 'limit', name: 'p7y-lim', refusal: lim })
    expect(reserveWake).toHaveBeenLastCalledWith('u@x', 'p7y-lim', 'deep_sleep')
    expect(composeUp).not.toHaveBeenCalled()
    composeText = 'traefik.http.routers.frps-x.entrypoints: web,websecure'
  })

  it('a sandbox started from the panel a moment ago: waits for its router (in_progress), not no_route', async () => {
    const { markWoken } = await import('../../services/wake')
    dirs = ['p7y-pn']
    vi.mocked(listManagedContainers).mockResolvedValue([sandboxMeta({ name: 'p7y-pn', owner: 'u@x', template: 't', status: 'running', container_id: 'x', created_at: '' })] as never)
    markWoken('p7y-pn')
    expect(await wakeByHost('pn-web.lvh.me')).toEqual({ result: 'in_progress', name: 'p7y-pn' })
  })
})

describe("p7y's own session probe never wakes a sandbox", () => {
  it('<raw>-p7y-wake.<domain> of a stopped sandbox: in progress, nothing started', async () => {
    const { reserveWake } = await import('../../services/quota')
    vi.mocked(reserveWake).mockClear()
    dirs = ['p7y-pw']
    vi.mocked(listManagedContainers).mockResolvedValue([sandboxMeta({ name: 'p7y-pw', owner: 'u@x', template: 't', status: 'exited', container_id: 'x', created_at: '' })] as never)
    vi.mocked(composeStart).mockReset(); vi.mocked(composeUp).mockReset()
    expect(await wakeByHost('pw-p7y-wake.lvh.me')).toEqual({ result: 'in_progress', name: 'p7y-pw' })
    expect(composeStart).not.toHaveBeenCalled()
    expect(reserveWake).not.toHaveBeenCalled()
  })
})
