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
      Config: { Labels: { 'leander.deep_sleep_after': '7d' } },
      NetworkSettings: { Networks: { default: { NetworkID: 'net-a' }, 'traefik-net': { NetworkID: 'net-b' } } },
      Mounts: [{ Destination: '/opt/users', Source: '/auto/detected/path' }, { Destination: '/opt/sandboxes', Source: '/auto/detected/sandboxes' }]
    })
  }
  return {
    default: vi.fn().mockImplementation(() => ({
      getContainer: vi.fn().mockReturnValue(mockContainer),
      listNetworks: vi.fn(async () => (globalThis as { __networks?: string[] }).__networks!.map(Id => ({ Id }))),
      listContainers: vi.fn().mockResolvedValue([
        {
          Id: 'abc123',
          Names: ['/leander-user1'],
          Ports: [{ PrivatePort: 2376, PublicPort: 32001, Type: 'tcp', IP: '0.0.0.0' }],
          Labels: { 'leander.managed': 'true', 'leander.template': 'dind-standard', 'leander.created_at': '2026-01-01T00:00:00.000Z' },
          State: 'running'
        }
      ])
    }))
  }
})

import {
  getContainerStatus,
  getContainerIdByName,
  resolveHostUsersDir,
  resolveHostSandboxesDir,
  _resetHostUsersDirCache,
  listManagedContainers,
  getSandboxState,
} from '../../services/docker'
import { composeDeepSleepAfter } from '../../services/sleepSettings'
import Dockerode from 'dockerode'

(globalThis as { __networks?: string[] }).__networks = ['net-a', 'net-b']

describe('getSandboxState', () => {
  it('flags a container attached to a network that no longer exists', async () => {
    (globalThis as { __networks?: string[] }).__networks = ['net-a', 'net-b']
    expect((await getSandboxState('leander-user1'))?.staleNetwork).toBe(false);
    (globalThis as { __networks?: string[] }).__networks = ['net-a', 'net-c']
    expect((await getSandboxState('leander-user1'))?.staleNetwork).toBe(true)
  })

  it('takes deep_sleep_after from the compose file, falling back to the container label', async () => {
    vi.mocked(composeDeepSleepAfter).mockReturnValueOnce('14d')
    expect((await getSandboxState('leander-user1'))?.deepSleepAfter).toBe('14d')
    vi.mocked(composeDeepSleepAfter).mockReturnValueOnce(undefined)
    expect((await getSandboxState('leander-user1'))?.deepSleepAfter).toBe('7d')
  })
})

describe('docker service', () => {
  it('getContainerStatus returns status string', async () => {
    expect(await getContainerStatus('abc123')).toBe('running')
  })

  it('getContainerIdByName returns container id', async () => {
    expect(await getContainerIdByName('leander-user1')).toBe('abc123')
  })

  it('listManagedContainers asks for p7y.* and legacy leander.* sandboxes, listing each container once', async () => {
    const list = await listManagedContainers()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('leander-user1')
    expect(list[0].template).toBe('dind-standard')
    expect(list[0].runtime).toBe('') // created before runtimes existed: no p7y.runtime label
    expect(list[0].compose).toBe('template') // no p7y.compose label: built from its template
    expect(list[0].ssh).toBe(false) // no p7y.ssh label: created before SSH
    expect(list[0].owner).toBe('admin')
    expect(list[0].status).toBe('running')
    expect(list[0].start_error).toBeUndefined()
  })

  it('listManagedContainers tells a sandbox that cannot start from an asleep one', async () => {
    const d = vi.mocked(Dockerode).mock.results[0].value
    const exited = { Id: 'abc123', Names: ['/leander-user1'], Labels: { 'leander.managed': 'true' }, State: 'exited' }
    const inspect = d.getContainer().inspect

    d.listContainers.mockResolvedValueOnce([exited]).mockResolvedValueOnce([exited])
    inspect.mockResolvedValueOnce({ State: { Status: 'exited', Error: 'error mounting "daemon.json": not a directory' } })
    expect((await listManagedContainers())[0].start_error).toBe('error mounting "daemon.json": not a directory')

    d.listContainers.mockResolvedValueOnce([exited]).mockResolvedValueOnce([exited])
    inspect.mockResolvedValueOnce({ State: { Status: 'exited', Error: '' } })
    expect((await listManagedContainers())[0].start_error).toBeUndefined()
  })

})

describe('resolveHostUsersDir', () => {
  const originalEnv = process.env.HOST_USERS_DIR

  beforeEach(() => {
    _resetHostUsersDirCache()
    delete process.env.HOST_USERS_DIR
  })

  afterEach(() => {
    _resetHostUsersDirCache()
    if (originalEnv !== undefined) {
      process.env.HOST_USERS_DIR = originalEnv
    } else {
      delete process.env.HOST_USERS_DIR
    }
  })

  it('returns HOST_USERS_DIR env var value when set', async () => {
    process.env.HOST_USERS_DIR = 'C:\\m\\docker\\csakaszamok\\leander\\opt\\users'
    const result = await resolveHostUsersDir()
    expect(result).toBe('C:/m/docker/csakaszamok/leander/opt/users')
  })

  it('returns HOST_USERS_DIR with trailing slash stripped', async () => {
    process.env.HOST_USERS_DIR = '/some/path/'
    const result = await resolveHostUsersDir()
    expect(result).toBe('/some/path')
  })

  it('returns auto-detected Source from inspect when HOST_USERS_DIR is not set', async () => {
    const result = await resolveHostUsersDir()
    expect(result).toBe('/auto/detected/path')
  })

  it('caches the result on subsequent calls', async () => {
    process.env.HOST_USERS_DIR = '/cached/path'
    const first = await resolveHostUsersDir()
    delete process.env.HOST_USERS_DIR
    const second = await resolveHostUsersDir()
    expect(first).toBe('/cached/path')
    expect(second).toBe('/cached/path')
  })
})

describe('resolveHostSandboxesDir', () => {
  const saved = { users: process.env.HOST_USERS_DIR, sandboxes: process.env.HOST_SANDBOXES_DIR }
  const inspect = () => new (vi.mocked(Dockerode))().getContainer('x').inspect as ReturnType<typeof vi.fn>
  beforeEach(() => { _resetHostUsersDirCache(); delete process.env.HOST_USERS_DIR; delete process.env.HOST_SANDBOXES_DIR })
  afterEach(() => {
    _resetHostUsersDirCache()
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
  it('then the sibling of HOST_USERS_DIR', async () => {
    inspect().mockResolvedValueOnce({ Mounts: [] })
    process.env.HOST_USERS_DIR = 'D:\\srv\\p7y\\opt\\users'
    expect(await resolveHostSandboxesDir()).toBe('D:/srv/p7y/opt/sandboxes')
  })
  it('else /opt/sandboxes (cannot tell)', async () => {
    inspect().mockResolvedValueOnce({ Mounts: [] })
    expect(await resolveHostSandboxesDir()).toBe('/opt/sandboxes')
  })
})
