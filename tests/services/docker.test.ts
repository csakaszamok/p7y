import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('node:fs', () => ({
  default: {
    readFileSync: vi.fn().mockReturnValue('container-abc\n')
  }
}))

vi.mock('../../services/sleepSettings', () => ({ composeDeepSleepAfter: vi.fn() }))

vi.mock('dockerode', () => {
  const mockContainer = {
    id: 'abc123',
    inspect: vi.fn().mockResolvedValue({
      Id: 'abc123',
      State: { Status: 'running', FinishedAt: '0001-01-01T00:00:00Z' },
      Config: { Labels: { 'p7y.deep_sleep_after': '7d' } },
      NetworkSettings: { Networks: { default: { NetworkID: 'net-a' }, 'traefik-net': { NetworkID: 'net-b' } } },
      Mounts: [{ Destination: '/opt/sandboxes', Source: '/auto/detected/sandboxes' }]
    })
  }
  return {
    // A function, not an arrow: `new Dockerode()` constructs it. One client, kept for the tests to steer
    default: vi.fn().mockImplementation(function () { return (globalThis as { __docker?: unknown }).__docker ??= {
      getContainer: vi.fn().mockReturnValue(mockContainer),
      listNetworks: vi.fn(async () => (globalThis as { __networks?: string[] }).__networks!.map(Id => ({ Id }))),
      listContainers: vi.fn().mockResolvedValue([
        {
          Id: 'abc123',
          Names: ['/p7y-user1'],
          Ports: [{ PrivatePort: 2376, PublicPort: 32001, Type: 'tcp', IP: '0.0.0.0' }],
          Labels: { 'p7y.managed': 'true', 'p7y.template': 'dind-standard', 'p7y.created_at': '2026-01-01T00:00:00.000Z' },
          State: 'running'
        }
      ])
    } })
  }
})

import {
  getContainerStatus,
  getContainerIdByName,
  resolveHostSandboxesDir,
  _resetHostSandboxesDirCache,
  listedSandboxState,
  listManagedContainers,
  getSandboxState,
} from '../../services/docker'
import { composeDeepSleepAfter } from '../../services/sleepSettings'
import Dockerode from 'dockerode'

(globalThis as { __networks?: string[] }).__networks = ['net-a', 'net-b']

describe('getSandboxState', () => {
  // The network list is shared for 2 s (a list asks for many sandboxes' states at once)
  it('flags a container attached to a network that no longer exists, once the shared list is 2 s old', async () => {
    const net = globalThis as { __networks?: string[] }
    net.__networks = ['net-a', 'net-b']
    expect((await getSandboxState('p7y-user1'))?.staleNetwork).toBe(false)
    net.__networks = ['net-a', 'net-c']
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2_500)
    try { expect((await getSandboxState('p7y-user1'))?.staleNetwork).toBe(true) } finally { now.mockRestore() }
  })

  // Stale takes the sandbox down (deep sleep): a network missing from the shared list is looked up afresh first
  it('does not call a network created since the shared list stale', async () => {
    const net = globalThis as { __networks?: string[] }
    net.__networks = ['net-a']
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000)
    try {
      expect((await getSandboxState('p7y-user1'))?.staleNetwork).toBe(true)
      net.__networks = ['net-a', 'net-b']
      expect((await getSandboxState('p7y-user1'))?.staleNetwork).toBe(false)
    } finally { now.mockRestore() }
  })

  it('takes deep_sleep_after from the compose file, falling back to the container label', async () => {
    vi.mocked(composeDeepSleepAfter).mockReturnValueOnce('14d')
    expect((await getSandboxState('p7y-user1'))?.deepSleepAfter).toBe('14d')
    vi.mocked(composeDeepSleepAfter).mockReturnValueOnce(undefined)
    expect((await getSandboxState('p7y-user1'))?.deepSleepAfter).toBe('7d')
  })
})

describe('docker service', () => {
  it('getContainerStatus returns status string', async () => {
    expect(await getContainerStatus('abc123')).toBe('running')
  })

  it('getContainerIdByName returns container id', async () => {
    expect(await getContainerIdByName('p7y-user1')).toBe('abc123')
  })

  it('listManagedContainers lists p7y.* sandboxes', async () => {
    const list = await listManagedContainers()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('p7y-user1')
    expect(list[0].template).toBe('dind-standard')
    expect(list[0].runtime).toBe('') // created before runtimes existed: no p7y.runtime label
    expect(list[0].compose).toBe('template') // no p7y.compose label: built from its template
    expect(list[0].ssh).toBe(false) // no p7y.ssh label: created before SSH
    expect(list[0].owner).toBe('admin')
    expect(list[0].status).toBe('running')
    expect(list[0].start_error).toBeUndefined()
  })

  it('listManagedContainers tells a sandbox that cannot start from an asleep one', async () => {
    const d = (globalThis as { __docker?: any }).__docker
    const exited = { Id: 'abc123', Names: ['/p7y-user1'], Labels: { 'p7y.managed': 'true' }, State: 'exited', Status: 'Exited (128) 2 seconds ago' }
    const inspect = d.getContainer().inspect

    d.listContainers.mockResolvedValueOnce([exited])
    inspect.mockResolvedValueOnce({ State: { Status: 'exited', Error: 'error mounting "daemon.json": not a directory' } })
    expect((await listManagedContainers())[0].start_error).toBe('error mounting "daemon.json": not a directory')

    // Started again and stopped: a new status text, asked again
    const again = { ...exited, Status: 'Exited (0) 1 second ago' }
    d.listContainers.mockResolvedValueOnce([again])
    inspect.mockResolvedValueOnce({ State: { Status: 'exited', Error: '' } })
    expect((await listManagedContainers())[0].start_error).toBeUndefined()
  })

  it('listedSandboxState inspects a listed container again only when its status text changed', async () => {
    const d = (globalThis as { __docker?: any }).__docker
    const inspect = d.getContainer().inspect
    const up = { Id: 'run1', Names: ['/p7y-listed'], Labels: { 'p7y.managed': 'true' }, State: 'running', Status: 'Up 5 minutes' }
    const list = (c: object) => d.listContainers.mockResolvedValueOnce([c])

    list(up)
    await listManagedContainers()
    inspect.mockClear()
    expect((await listedSandboxState('p7y-listed'))?.status).toBe('running')
    expect((await listedSandboxState('p7y-listed'))?.status).toBe('running')
    expect(inspect).toHaveBeenCalledTimes(1)

    // Stopped since: listed with a new status text, so inspected again
    list({ ...up, State: 'exited', Status: 'Exited (0) 1 second ago' })
    await listManagedContainers() // asks its start error (the list's own inspect)
    inspect.mockClear()
    inspect.mockResolvedValueOnce({ State: { Status: 'exited', FinishedAt: '2026-10-24T12:00:00Z' }, Config: { Labels: {} } })
    expect((await listedSandboxState('p7y-listed'))?.status).toBe('exited')
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it('listedSandboxState does not ask Docker for a sandbox a list just made did not show (deep sleep)', async () => {
    const d = (globalThis as { __docker?: any }).__docker
    const inspect = d.getContainer().inspect
    d.listContainers.mockResolvedValueOnce([])
    await listManagedContainers()
    inspect.mockClear()
    expect(await listedSandboxState('p7y-deep')).toBeNull()
    expect(inspect).not.toHaveBeenCalled()
  })

  it('listedSandboxState asks Docker each time when no list was made just now', async () => {
    const d = (globalThis as { __docker?: any }).__docker
    const inspect = d.getContainer().inspect
    const up = { Id: 'run2', Names: ['/p7y-old'], Labels: { 'p7y.managed': 'true' }, State: 'running', Status: 'Up 2 hours' }
    d.listContainers.mockResolvedValueOnce([up])
    await listManagedContainers()
    inspect.mockClear()
    const later = Date.now() + 6000
    const now = vi.spyOn(Date, 'now').mockReturnValue(later)
    try {
      await listedSandboxState('p7y-old')
      await listedSandboxState('p7y-old')
      expect(inspect).toHaveBeenCalledTimes(2)
    } finally { now.mockRestore() }
  })

  it('listManagedContainers does not ask an asleep sandbox again while its status is the same', async () => {
    const d = (globalThis as { __docker?: any }).__docker
    const exited = { Id: 'def456', Names: ['/p7y-asleep'], Labels: { 'p7y.managed': 'true' }, State: 'exited', Status: 'Exited (0) 5 minutes ago' }
    const inspect = d.getContainer().inspect
    inspect.mockClear()

    d.listContainers.mockResolvedValueOnce([exited])
    inspect.mockResolvedValueOnce({ State: { Status: 'exited', Error: 'no such network' } })
    expect((await listManagedContainers())[0].start_error).toBe('no such network')

    d.listContainers.mockResolvedValueOnce([exited])
    expect((await listManagedContainers())[0].start_error).toBe('no such network')
    expect(inspect).toHaveBeenCalledTimes(1)
  })

})

describe('resolveHostSandboxesDir', () => {
  const saved = { users: process.env.HOST_USERS_DIR, sandboxes: process.env.HOST_SANDBOXES_DIR }
  const inspect = () => new (vi.mocked(Dockerode))().getContainer('x').inspect as ReturnType<typeof vi.fn>
  beforeEach(() => { _resetHostSandboxesDirCache(); delete process.env.HOST_USERS_DIR; delete process.env.HOST_SANDBOXES_DIR })
  afterEach(() => {
    _resetHostSandboxesDirCache()
    for (const [k, v] of [['HOST_USERS_DIR', saved.users], ['HOST_SANDBOXES_DIR', saved.sandboxes]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v
    }
  })

  it('HOST_SANDBOXES_DIR first, with forward slashes and no trailing slash', async () => {
    process.env.HOST_SANDBOXES_DIR = 'C:\\x\\opt\\sandboxes\\'
    process.env.HOST_USERS_DIR = '/elsewhere/opt/users'
    expect(await resolveHostSandboxesDir()).toBe('C:/x/opt/sandboxes')
  })
  it("then the source of p7y's own mount on /opt/sandboxes", async () => {
    process.env.HOST_USERS_DIR = '/elsewhere/opt/users'
    expect(await resolveHostSandboxesDir()).toBe('/auto/detected/sandboxes')
  })
  it('ignores HOST_USERS_DIR (the former opt/users)', async () => {
    inspect().mockResolvedValueOnce({ Mounts: [] })
    process.env.HOST_USERS_DIR = 'D:\\srv\\p7y\\opt\\users'
    expect(await resolveHostSandboxesDir()).toBe('/opt/sandboxes')
  })
  it('else /opt/sandboxes (cannot tell)', async () => {
    inspect().mockResolvedValueOnce({ Mounts: [] })
    expect(await resolveHostSandboxesDir()).toBe('/opt/sandboxes')
  })
})
