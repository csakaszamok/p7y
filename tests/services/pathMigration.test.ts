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

const OLD = 'C:/m/docker/csakaszamok/leander/opt/users'
const NEW = 'C:/m/docker/csakaszamok/p7y/opt/users'

// The shape the templates generate: bind mounts from ${host_users_dir}/<name>/
const compose = (dir: string, name: string) => `services:
  sandbox:
    image: csakaszamok/foxglove:0.5.9-dind
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-users-'))
  for (const [name, hostDir] of Object.entries(sandboxes)) {
    fs.mkdirSync(`${dir}/${name}`)
    fs.writeFileSync(`${dir}/${name}/docker-compose.yml`, compose(hostDir, name))
  }
  return dir
}
const read = (dir: string, name: string) => fs.readFileSync(`${dir}/${name}/docker-compose.yml`, 'utf8')

describe('mountedUsersDir / withUsersDir', () => {
  it('finds the host directory of the bind mounts', () => {
    expect(mountedUsersDir(compose(OLD, 'leander-a'), 'leander-a')).toBe(OLD)
    expect(mountedUsersDir(compose('/srv/p7y/opt/users', 'p7y-b'), 'p7y-b')).toBe('/srv/p7y/opt/users')
    expect(mountedUsersDir('services:\n  sandbox:\n    image: x\n', 'p7y-b')).toBeNull()
  })

  it('moves every mount of the sandbox and nothing else', () => {
    const out = withUsersDir(compose(OLD, 'leander-a'), 'leander-a', OLD, NEW)
    expect(out).toBe(compose(NEW, 'leander-a'))
    expect(out).toContain('docker_data:/var/lib/docker')
  })
})

describe('migrateHostPaths', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rewrites moved sandboxes; starts running and failed ones, recreates asleep ones stopped, only rewrites deep-sleeping ones', async () => {
    const dir = usersDir({ 'leander-run': OLD, 'leander-failed': OLD, 'leander-sleep': OLD, 'leander-deep': OLD, 'p7y-new': NEW })
    vi.mocked(getSandboxState).mockImplementation(async name => ({
      'leander-run': state('running'),
      'leander-failed': state('exited', 'error mounting ".../daemon.json": not a directory'),
      'leander-sleep': state('exited'),
      'p7y-new': state('running'),
    } as Record<string, ReturnType<typeof state>>)[name] ?? null)

    const migrated = await migrateHostPaths(dir, NEW)

    expect(migrated.sort()).toEqual(['leander-deep', 'leander-failed', 'leander-run', 'leander-sleep'])
    for (const n of migrated) expect(read(dir, n)).toBe(compose(NEW, n))
    expect(read(dir, 'p7y-new')).toBe(compose(NEW, 'p7y-new'))
    expect(vi.mocked(composeUp).mock.calls.map(c => c[0]).sort())
      .toEqual([`${dir}/leander-failed/docker-compose.yml`, `${dir}/leander-run/docker-compose.yml`])
    expect(composeCreate).toHaveBeenCalledTimes(1)
    expect(composeCreate).toHaveBeenCalledWith(`${dir}/leander-sleep/docker-compose.yml`)
  })

  it('does nothing when it cannot tell the host directory', async () => {
    const dir = usersDir({ 'leander-a': OLD })
    expect(await migrateHostPaths(dir, '/opt/users')).toEqual([])
    expect(read(dir, 'leander-a')).toBe(compose(OLD, 'leander-a'))
  })

  it('puts the file back when recreating fails, so the next start retries', async () => {
    const dir = usersDir({ 'leander-a': OLD, 'leander-b': OLD })
    vi.mocked(getSandboxState).mockResolvedValue(state('running'))
    vi.mocked(composeUp).mockRejectedValueOnce(new Error('boom'))
    expect((await migrateHostPaths(dir, NEW)).length).toBe(1)
    expect(['leander-a', 'leander-b'].map(n => mountedUsersDir(read(dir, n), n)).sort()).toEqual([OLD, NEW].sort())
  })
})

describe('migrateHostPaths in the per-owner layout', () => {
  it("points a moved checkout's sandboxes at <host>/<owner>/<name>/; leaves not-yet-moved legacy ones to the startup move", async () => {
    const { resolveHostSandboxesDir } = await import('../../services/docker')
    const { forgetSandboxDir } = await import('../../services/sandboxPaths')
    const saved = { s: process.env.SANDBOXES_DIR, l: process.env.LEGACY_USERS_DIR }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-owners-')).replace(/\\/g, '/')
    const legacy = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-legacy-')).replace(/\\/g, '/')
    process.env.SANDBOXES_DIR = root; process.env.LEGACY_USERS_DIR = legacy; forgetSandboxDir()
    try {
      fs.mkdirSync(`${root}/ann@x/p7y-o`, { recursive: true })
      fs.writeFileSync(`${root}/ann@x/p7y-o/docker-compose.yml`, compose('/old/opt/sandboxes/ann@x', 'p7y-o') + '        p7y.owner: ann@x\n')
      fs.mkdirSync(`${legacy}/p7y-l`)
      fs.writeFileSync(`${legacy}/p7y-l/docker-compose.yml`, compose('/old/opt/users', 'p7y-l'))
      vi.mocked(resolveHostSandboxesDir).mockResolvedValue('/new/opt/sandboxes')
      vi.mocked(getSandboxState).mockResolvedValue(null)
      expect(await migrateHostPaths()).toEqual(['p7y-o'])
      expect(mountedUsersDir(fs.readFileSync(`${root}/ann@x/p7y-o/docker-compose.yml`, 'utf8'), 'p7y-o')).toBe('/new/opt/sandboxes/ann@x')
      expect(mountedUsersDir(fs.readFileSync(`${legacy}/p7y-l/docker-compose.yml`, 'utf8'), 'p7y-l')).toBe('/old/opt/users')
    } finally { process.env.SANDBOXES_DIR = saved.s; process.env.LEGACY_USERS_DIR = saved.l; forgetSandboxDir() }
  })
})

describe('migrateHostPaths takes the owner directory from where the files are', () => {
  it('an owner label it cannot read does not send the mounts to admin/', async () => {
    const { resolveHostSandboxesDir } = await import('../../services/docker')
    const { forgetSandboxDir } = await import('../../services/sandboxPaths')
    const saved = process.env.SANDBOXES_DIR
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-owners-')).split(path.sep).join('/')
    process.env.SANDBOXES_DIR = root; forgetSandboxDir()
    try {
      fs.mkdirSync(`${root}/o_brien@x/p7y-q`, { recursive: true })
      fs.writeFileSync(`${root}/o_brien@x/p7y-q/docker-compose.yml`, compose('/old/opt/sandboxes/o_brien@x', 'p7y-q') + '        p7y.owner: weird value\n')
      vi.mocked(resolveHostSandboxesDir).mockResolvedValue('/new/opt/sandboxes')
      vi.mocked(getSandboxState).mockResolvedValue(null)
      await migrateHostPaths()
      expect(mountedUsersDir(fs.readFileSync(`${root}/o_brien@x/p7y-q/docker-compose.yml`, 'utf8'), 'p7y-q')).toBe('/new/opt/sandboxes/o_brien@x')
    } finally { process.env.SANDBOXES_DIR = saved; forgetSandboxDir() }
  })
})
