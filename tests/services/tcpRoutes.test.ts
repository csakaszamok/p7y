import { describe, it, expect, vi, beforeEach } from 'vitest'
import net from 'node:net'

vi.mock('../../services/tcpNames', () => ({ publicTcpPorts: vi.fn() }))
vi.mock('../../services/wake', () => ({ findSandboxDirByHost: vi.fn(), wakeInProgress: vi.fn(() => false) }))
vi.mock('../../services/docker', () => ({ getSandboxState: vi.fn() }))
vi.mock('../../services/sandbox', () => ({ sandboxService: { startSandbox: vi.fn(async () => {}) } }))
vi.mock('../../services/sandboxSsh', () => ({ sandboxHasSsh: vi.fn(() => true) }))
vi.mock('../../services/dockerAccess', () => ({ dockerAccessState: vi.fn(() => 'ready') }))

import { resolveTcpHost, resolveDockerHost, _resetTcpRoutes } from '../../services/tcpRoutes'
import { dockerAccessState } from '../../services/dockerAccess'
import { publicTcpPorts } from '../../services/tcpNames'
import { findSandboxDirByHost, wakeInProgress } from '../../services/wake'
import { getSandboxState } from '../../services/docker'
import { sandboxHasSsh } from '../../services/sandboxSsh'
import { sandboxService } from '../../services/sandbox'

const running = { name: 'p7y-shop', status: 'running', finishedAt: '', deepSleepAfter: '7d', staleNetwork: false, error: '' }
async function listener(): Promise<{ port: number; close: () => void }> {
  const s = net.createServer(sock => sock.end()); await new Promise<void>(r => s.listen(0, '127.0.0.1', r))
  return { port: (s.address() as net.AddressInfo).port, close: () => s.close() }
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetTcpRoutes()
  vi.stubEnv('HOST_DOMAIN', 'lvh.me')
  vi.mocked(findSandboxDirByHost).mockImplementation(h => (h.startsWith('shop-') ? 'p7y-shop' : null))
})

describe('resolveTcpHost', () => {
  it('sends <sandbox>-shell-tcp to port 22 of the sandbox container, without asking for published ports', async () => {
    const l = await listener()
    vi.mocked(getSandboxState).mockResolvedValue(running)
    expect(await resolveTcpHost('shop-shell-tcp.lvh.me', { host: '127.0.0.1', sshPort: l.port, deadlineMs: 2000, retryMs: 50 }))
      .toEqual({ host: '127.0.0.1', port: l.port })
    expect(publicTcpPorts).not.toHaveBeenCalled()
    l.close()
  })

  it('answers no such address at once for <sandbox>-shell-tcp of a sandbox without SSH', async () => {
    vi.mocked(sandboxHasSsh).mockReturnValueOnce(false)
    const started = Date.now()
    expect(await resolveTcpHost('shop-shell-tcp.lvh.me', { deadlineMs: 5000 })).toBeNull()
    expect(Date.now() - started).toBeLessThan(500)
    expect(getSandboxState).not.toHaveBeenCalled() // nothing woken
  })

  it('maps a -tcp name of a running sandbox to its container and port', async () => {
    const l = await listener()
    vi.mocked(getSandboxState).mockResolvedValue(running)
    vi.mocked(publicTcpPorts).mockResolvedValue([{ host: 'shop-inner-db-port5432-tcp.lvh.me', port: l.port, privatePort: l.port }])
    expect(await resolveTcpHost('shop-inner-db-port5432-tcp.lvh.me', { host: '127.0.0.1' }))
      .toEqual({ host: '127.0.0.1', port: l.port })
    expect(findSandboxDirByHost).toHaveBeenCalledWith('shop-inner-db-port5432.lvh.me')
    expect(sandboxService.startSandbox).not.toHaveBeenCalled()
    l.close()
  })

  it('rejects names without -tcp, other domains, unknown sandboxes and unpublished ports', async () => {
    vi.mocked(getSandboxState).mockResolvedValue(running)
    vi.mocked(publicTcpPorts).mockResolvedValue([])
    expect(await resolveTcpHost('shop-inner-db-port5432.lvh.me')).toBeNull()
    expect(await resolveTcpHost('shop-x-tcp.example.com')).toBeNull()
    expect(await resolveTcpHost('nobody-x-tcp.lvh.me')).toBeNull()
    expect(await resolveTcpHost('shop-portainer-tcp.lvh.me', { deadlineMs: 300, retryMs: 50 })).toBeNull()
  })

  it('answers at once, without waiting, when a running sandbox has no such published port (e.g. 127.0.0.1-only)', async () => {
    vi.mocked(getSandboxState).mockResolvedValue(running)
    vi.mocked(publicTcpPorts).mockResolvedValue([{ host: 'shop-other-port80-tcp.lvh.me', port: 80, privatePort: 80 }])
    const t0 = Date.now()
    expect(await resolveTcpHost('shop-pgpriv-port5433-tcp.lvh.me', { retryMs: 50 })).toBeNull()
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  it('wakes a sleeping sandbox, opens its Sablier session, and waits until the port answers', async () => {
    vi.mocked(getSandboxState).mockResolvedValue({ ...running, status: 'exited' })
    let l: { port: number; close: () => void } | null = null
    vi.mocked(publicTcpPorts).mockImplementation(async () => {
      if (!l) { l = await listener(); throw new Error('inner docker not up yet') }
      return [{ host: 'shop-inner-db-port5432-tcp.lvh.me', port: l.port, privatePort: l.port }]
    })
    const target = await resolveTcpHost('shop-inner-db-port5432-tcp.lvh.me', { host: '127.0.0.1', retryMs: 50 })
    expect(sandboxService.startSandbox).toHaveBeenCalledWith('p7y-shop')
    expect(target?.port).toBe(l!.port)
    l!.close()
  })

  it('keeps retrying while the port refuses, until the app listens', async () => {
    vi.mocked(getSandboxState).mockResolvedValue(running)
    const probe = await listener(); const port = probe.port; probe.close()
    vi.mocked(publicTcpPorts).mockResolvedValue([{ host: 'shop-db-tcp.lvh.me', port, privatePort: port }])
    let late: net.Server | null = null
    setTimeout(() => { late = net.createServer(s => s.end()).listen(port, '127.0.0.1') }, 300)
    const target = await resolveTcpHost('shop-db-tcp.lvh.me', { host: '127.0.0.1', retryMs: 50, deadlineMs: 5000 })
    expect(target).toEqual({ host: '127.0.0.1', port })
    late!.close()
  })
})

describe('resolveTcpHost under load and while waking', () => {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

  it('wakes a sandbox once for many connections at the same time', async () => {
    const l = await listener()
    let up = false
    vi.mocked(getSandboxState).mockImplementation(async () => (up ? { ...running, startedAt: minutesAgo(0) } : { ...running, status: 'exited' }))
    vi.mocked(sandboxService.startSandbox).mockImplementation(async () => { await new Promise(r => setTimeout(r, 100)); up = true })
    vi.mocked(publicTcpPorts).mockResolvedValue([{ host: 'shop-db-tcp.lvh.me', port: l.port, privatePort: l.port }])
    const all = await Promise.all(Array.from({ length: 10 }, () => resolveTcpHost('shop-db-tcp.lvh.me', { host: '127.0.0.1', retryMs: 20 })))
    expect(all.every(t => t?.port === l.port)).toBe(true)
    expect(sandboxService.startSandbox).toHaveBeenCalledTimes(1)
    l.close()
  })

  it('does not start a sandbox the HTTP wake is already bringing up', async () => {
    const l = await listener()
    vi.mocked(getSandboxState).mockResolvedValue({ ...running, status: 'deep_sleep' } as never)
    vi.mocked(wakeInProgress).mockReturnValue(true)
    vi.mocked(publicTcpPorts).mockResolvedValue([{ host: 'shop-db-tcp.lvh.me', port: l.port, privatePort: l.port }])
    expect((await resolveTcpHost('shop-db-tcp.lvh.me', { host: '127.0.0.1', retryMs: 20 }))?.port).toBe(l.port)
    expect(sandboxService.startSandbox).not.toHaveBeenCalled()
    l.close()
  })

  it('asks the inner Docker once for connections arriving together', async () => {
    const l = await listener()
    vi.mocked(getSandboxState).mockResolvedValue({ ...running, startedAt: minutesAgo(10) })
    vi.mocked(publicTcpPorts).mockResolvedValue([{ host: 'shop-db-tcp.lvh.me', port: l.port, privatePort: l.port }])
    await Promise.all(Array.from({ length: 10 }, () => resolveTcpHost('shop-db-tcp.lvh.me', { host: '127.0.0.1' })))
    expect(vi.mocked(publicTcpPorts).mock.calls.length).toBeLessThanOrEqual(2)
    l.close()
  })

  it('stops waiting when the client has gone', async () => {
    vi.mocked(getSandboxState).mockResolvedValue({ ...running, status: 'exited' })
    vi.mocked(publicTcpPorts).mockRejectedValue(new Error('not up'))
    const gone = new AbortController()
    setTimeout(() => gone.abort(), 150)
    const t0 = Date.now()
    expect(await resolveTcpHost('shop-db-tcp.lvh.me', { retryMs: 20, signal: gone.signal })).toBeNull()
    expect(Date.now() - t0).toBeLessThan(1500)
  })

  it('keeps waiting for a sandbox that has only just started, even though its port is not listed yet', async () => {
    const l = await listener()
    vi.mocked(getSandboxState).mockResolvedValue({ ...running, startedAt: minutesAgo(0.05) })
    let calls = 0
    vi.mocked(publicTcpPorts).mockImplementation(async () => (++calls < 3 ? [] : [{ host: 'shop-db-tcp.lvh.me', port: l.port, privatePort: l.port }]))
    expect((await resolveTcpHost('shop-db-tcp.lvh.me', { host: '127.0.0.1', retryMs: 20 }))?.port).toBe(l.port)
    l.close()
  })
})

describe('resolveDockerHost', () => {
  it('sends <raw>-docker to the sandbox dockerd, only when its certificate is ready', async () => {
    const l = await listener()
    vi.mocked(getSandboxState).mockResolvedValue({ name: 'p7y-shop', status: 'running' } as never)
    expect(await resolveDockerHost('shop-docker.lvh.me', { host: '127.0.0.1', port: l.port, deadlineMs: 2000 })).toEqual({ host: '127.0.0.1', port: l.port })
    vi.mocked(dockerAccessState).mockReturnValueOnce('needs-certs')
    expect(await resolveDockerHost('shop-docker.lvh.me', { host: '127.0.0.1', port: l.port, deadlineMs: 2000 })).toBeNull()
    l.close()
  })
  it('null for another sandbox\'s longer name, an unknown sandbox, or a -tcp name', async () => {
    expect(await resolveDockerHost('shop-x-docker.lvh.me', { deadlineMs: 500 })).toBeNull()
    expect(await resolveDockerHost('nope-docker.lvh.me', { deadlineMs: 500 })).toBeNull()
    expect(await resolveDockerHost('shop-tcp.lvh.me', { deadlineMs: 500 })).toBeNull()
  })
  // Docker Desktop keeps every context connected and reconnects at once: waking on a connection woke the
  // sandbox again each time it went to sleep. Answered at once, without the wait.
  it('does not wake a sleeping sandbox', async () => {
    vi.mocked(wakeInProgress).mockReturnValue(false) // an earlier test leaves it true
    vi.mocked(sandboxService.startSandbox).mockClear()
    vi.mocked(getSandboxState).mockResolvedValue({ name: 'p7y-shop', status: 'exited' } as never)
    const t0 = Date.now()
    expect(await resolveDockerHost('shop-docker.lvh.me', { deadlineMs: 5000 })).toBeNull()
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(sandboxService.startSandbox).not.toHaveBeenCalled()
  })
  it('waits for a wake already under way (Wake in the UI, an app opened)', async () => {
    const l = await listener()
    vi.mocked(wakeInProgress).mockReturnValue(true)
    vi.mocked(getSandboxState).mockResolvedValue({ name: 'p7y-shop', status: 'exited' } as never)
    expect(await resolveDockerHost('shop-docker.lvh.me', { host: '127.0.0.1', port: l.port, deadlineMs: 2000 })).toEqual({ host: '127.0.0.1', port: l.port })
    vi.mocked(wakeInProgress).mockReturnValue(false)
    l.close()
  })
})

describe('the limit', () => {
  it("an asleep sandbox at its owner's limit: answered at once (null), not after the wait", async () => {
    vi.mocked(getSandboxState).mockResolvedValue({ ...running, status: 'exited' })
    vi.mocked(sandboxService.startSandbox).mockRejectedValueOnce(Object.assign(new Error('Running limit reached'), { code: 'LIMIT' }))
    const t0 = Date.now()
    expect(await resolveTcpHost('shop-db-tcp.lvh.me', { deadlineMs: 5000, retryMs: 10 })).toBeNull()
    expect(Date.now() - t0).toBeLessThan(1000)
  })
})
