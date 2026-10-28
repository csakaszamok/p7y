import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('../../services/compose', () => ({
  composeUp: vi.fn().mockResolvedValue(undefined),
  composeCreate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../services/docker', () => ({ getSandboxState: vi.fn(), resolveHostSandboxesDir: vi.fn() }))

import { mountedUsersDir, withUsersDir, migrateHostPaths } from '../../services/pathMigration'
import { composeUp, composeCreate } from '../../services/compose'
import { getSandboxState } from '../../services/docker'

const OLD = '/srv/old/p9m/opt/sandboxes/admin'
const NEW = '/data/p9m/opt/sandboxes/admin'

// The shape the templates generate: bind mounts from ${host_users_dir}/<name>/
const compose = (dir: string, name: string) => `services:
  sandbox:
    image: ghcr.io/csakaszamok/foxglove:0.10.0-dind
    volumes:
      - ${dir}/${name}/certs:/certs
      - ${dir}/${name}/instance-name:/etc/instance/name:ro
      - ${dir}/${name}/inner:/inner
      - ${dir}/${name}/daemon.json:/etc/docker/daemon.json:ro
      - docker_data:/var/lib/docker
  frps:
    image: fatedier/frps:v0.62.1
    volumes:
      - ${dir}/${name}/frps.toml:/etc/frp/frps.toml:ro
`
const state = (status: string, error = '') =>
  ({ name: 'x', status, finishedAt: '', deepSleepAfter: '7d', staleNetwork: false, error })

function usersDir(sandboxes: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p9m-users-'))
  for (const [name, hostDir] of Object.entries(sandboxes)) {
    fs.mkdirSync(`${dir}/${name}`)
    fs.writeFileSync(`${dir}/${name}/docker-compose.yml`, compose(hostDir, name))
  }
  return dir
}
const read = (dir: string, name: string) => fs.readFileSync(`${dir}/${name}/docker-compose.yml`, 'utf8')

describe('mountedUsersDir / withUsersDir', () => {
  it('finds the host directory of the bind mounts', () => {
    expect(mountedUsersDir(compose(OLD, 'p9m-a'), 'p9m-a')).toBe(OLD)
    expect(mountedUsersDir(compose('/srv/p9m/opt/sandboxes/admin', 'p9m-b'), 'p9m-b')).toBe('/srv/p9m/opt/sandboxes/admin')
    expect(mountedUsersDir('services:\n  sandbox:\n    image: x\n', 'p9m-b')).toBeNull()
  })

  it('moves every mount of the sandbox and nothing else', () => {
    const out = withUsersDir(compose(OLD, 'p9m-a'), 'p9m-a', OLD, NEW)
    expect(out).toBe(compose(NEW, 'p9m-a'))
    expect(out).toContain('docker_data:/var/lib/docker')
  })
})

describe('migrateHostPaths', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rewrites moved sandboxes; starts running and failed ones, recreates asleep ones stopped, only rewrites deep-sleeping ones', async () => {
    const dir = usersDir({ 'p9m-run': OLD, 'p9m-failed': OLD, 'p9m-sleep': OLD, 'p9m-deep': OLD, 'p9m-new': NEW })
    vi.mocked(getSandboxState).mockImplementation(async name => ({
      'p9m-run': state('running'),
      'p9m-failed': state('exited', 'error mounting ".../daemon.json": not a directory'),
      'p9m-sleep': state('exited'),
      'p9m-new': state('running'),
    } as Record<string, ReturnType<typeof state>>)[name] ?? null)

    const migrated = await migrateHostPaths(dir, NEW)

    expect(migrated.sort()).toEqual(['p9m-deep', 'p9m-failed', 'p9m-run', 'p9m-sleep'])
    for (const n of migrated) expect(read(dir, n)).toBe(compose(NEW, n))
    expect(read(dir, 'p9m-new')).toBe(compose(NEW, 'p9m-new'))
    expect(vi.mocked(composeUp).mock.calls.map(c => c[0]).sort())
      .toEqual([`${dir}/p9m-failed/docker-compose.yml`, `${dir}/p9m-run/docker-compose.yml`])
    expect(composeCreate).toHaveBeenCalledTimes(1)
    expect(composeCreate).toHaveBeenCalledWith(`${dir}/p9m-sleep/docker-compose.yml`)
  })

  it('does nothing when it cannot tell the host directory', async () => {
    const dir = usersDir({ 'p9m-a': OLD })
    expect(await migrateHostPaths(dir, '/opt/sandboxes')).toEqual([])
    expect(read(dir, 'p9m-a')).toBe(compose(OLD, 'p9m-a'))
  })

  it('puts the file back when recreating fails, so the next start retries', async () => {
    const dir = usersDir({ 'p9m-a': OLD, 'p9m-b': OLD })
    vi.mocked(getSandboxState).mockResolvedValue(state('running'))
    vi.mocked(composeUp).mockRejectedValueOnce(new Error('boom'))
    expect((await migrateHostPaths(dir, NEW)).length).toBe(1)
    expect(['p9m-a', 'p9m-b'].map(n => mountedUsersDir(read(dir, n), n)).sort()).toEqual([OLD, NEW].sort())
  })
})

describe('migrateHostPaths in the per-owner layout', () => {
  it("points a moved install's sandboxes at <host>/<owner>/<name>/", async () => {
    const { resolveHostSandboxesDir } = await import('../../services/docker')
    const { forgetSandboxDir } = await import('../../services/sandboxPaths')
    const saved = process.env.SANDBOXES_DIR
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p9m-owners-')).replace(/\\/g, '/')
    process.env.SANDBOXES_DIR = root; forgetSandboxDir()
    try {
      fs.mkdirSync(`${root}/ann@x/p9m-o`, { recursive: true })
      fs.writeFileSync(`${root}/ann@x/p9m-o/docker-compose.yml`, compose('/old/opt/sandboxes/ann@x', 'p9m-o') + '        p9m.owner: ann@x\n')
      vi.mocked(resolveHostSandboxesDir).mockResolvedValue('/new/opt/sandboxes')
      vi.mocked(getSandboxState).mockResolvedValue(null)
      expect(await migrateHostPaths()).toEqual(['p9m-o'])
      expect(mountedUsersDir(fs.readFileSync(`${root}/ann@x/p9m-o/docker-compose.yml`, 'utf8'), 'p9m-o')).toBe('/new/opt/sandboxes/ann@x')
    } finally { process.env.SANDBOXES_DIR = saved; forgetSandboxDir() }
  })
})

describe('migrateHostPaths takes the owner directory from where the files are', () => {
  it('an owner label it cannot read does not send the mounts to admin/', async () => {
    const { resolveHostSandboxesDir } = await import('../../services/docker')
    const { forgetSandboxDir } = await import('../../services/sandboxPaths')
    const saved = process.env.SANDBOXES_DIR
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p9m-owners-')).split(path.sep).join('/')
    process.env.SANDBOXES_DIR = root; forgetSandboxDir()
    try {
      fs.mkdirSync(`${root}/o_brien@x/p9m-q`, { recursive: true })
      fs.writeFileSync(`${root}/o_brien@x/p9m-q/docker-compose.yml`, compose('/old/opt/sandboxes/o_brien@x', 'p9m-q') + '        p9m.owner: weird value\n')
      vi.mocked(resolveHostSandboxesDir).mockResolvedValue('/new/opt/sandboxes')
      vi.mocked(getSandboxState).mockResolvedValue(null)
      await migrateHostPaths()
      expect(mountedUsersDir(fs.readFileSync(`${root}/o_brien@x/p9m-q/docker-compose.yml`, 'utf8'), 'p9m-q')).toBe('/new/opt/sandboxes/o_brien@x')
    } finally { process.env.SANDBOXES_DIR = saved; forgetSandboxDir() }
  })
})
