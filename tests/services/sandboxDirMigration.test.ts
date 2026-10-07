import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { migrateSandboxDirs, migrateArchives } from '../../services/sandboxDirMigration'
import { forgetSandboxDir } from '../../services/sandboxPaths'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-sdm-')).replace(/\\/g, '/')
const compose = (hostDir: string, name: string, owner = 'a@b.c') => `services:
  sandbox:
    volumes:
      - ${hostDir}/${name}/certs:/certs
      - docker_data:/var/lib/docker
    labels:
      p7y.owner: "${owner}"
  frps:
    volumes:
      - ${hostDir}/${name}/frps.toml:/etc/frp/frps.toml:ro
`
let S = '', L = '', A = ''
const legacy = (name: string, owner = 'a@b.c') => {
  fs.mkdirSync(`${L}/${name}/certs/server`, { recursive: true })
  fs.writeFileSync(`${L}/${name}/certs/server/ca.pem`, 'CA')
  fs.writeFileSync(`${L}/${name}/docker-compose.yml`, compose('C:/old/opt/users', name, owner))
}
const deps = (states: Record<string, { status: string; error?: boolean } | null> = {}) => {
  const calls: string[] = []
  return {
    calls,
    d: {
      hostDir: async () => 'C:/new/opt/sandboxes',
      status: vi.fn(async (n: string) => states[n] ?? null),
      up: vi.fn(async (f: string) => { calls.push(`up ${f}`); expect(fs.existsSync(f)).toBe(true) }),
      create: vi.fn(async (f: string) => { calls.push(`create ${f}`) }),
      log: () => {},
    },
  }
}

beforeEach(() => {
  S = tmp(); L = tmp(); A = tmp()
  process.env.SANDBOXES_DIR = S; process.env.LEGACY_USERS_DIR = L; process.env.ARCHIVE_DIR = A
  forgetSandboxDir()
})

describe('migrateSandboxDirs', () => {
  it("running: copied to its owner's directory, mounts rewritten, recreated and started, then the legacy dir removed", async () => {
    legacy('p7y-a')
    const { calls, d } = deps({ 'p7y-a': { status: 'running' } })
    expect(await migrateSandboxDirs(d)).toEqual(['p7y-a'])
    const dir = `${S}/a@b.c/p7y-a`
    expect(fs.readFileSync(`${dir}/certs/server/ca.pem`, 'utf8')).toBe('CA')
    const text = fs.readFileSync(`${dir}/docker-compose.yml`, 'utf8')
    expect(text).toContain('- C:/new/opt/sandboxes/a@b.c/p7y-a/certs:/certs')
    expect(text).toContain('- C:/new/opt/sandboxes/a@b.c/p7y-a/frps.toml:/etc/frp/frps.toml:ro')
    expect(text).not.toContain('C:/old')
    expect(calls).toEqual([`up ${dir}/docker-compose.yml`])
    expect(fs.existsSync(`${L}/p7y-a`)).toBe(false)
  })

  it('a failed last start counts as running; asleep: recreated stopped; deep sleep: only moved', async () => {
    legacy('p7y-f'); legacy('p7y-s', 'admin'); legacy('p7y-d')
    const { calls, d } = deps({ 'p7y-f': { status: 'exited', error: true }, 'p7y-s': { status: 'exited' } })
    expect((await migrateSandboxDirs(d)).sort()).toEqual(['p7y-d', 'p7y-f', 'p7y-s'])
    expect(calls.sort()).toEqual([`create ${S}/admin/p7y-s/docker-compose.yml`, `up ${S}/a@b.c/p7y-f/docker-compose.yml`])
    expect(fs.existsSync(`${S}/a@b.c/p7y-d/docker-compose.yml`)).toBe(true)
    expect(fs.readdirSync(L)).toEqual([])
  })

  it('a failure leaves the legacy dir as it was and no half-written target; the next start finishes the move', async () => {
    legacy('p7y-a')
    const before = fs.readFileSync(`${L}/p7y-a/docker-compose.yml`, 'utf8')
    const { d } = deps({ 'p7y-a': { status: 'running' } })
    d.up.mockRejectedValueOnce(new Error('boom'))
    expect(await migrateSandboxDirs(d)).toEqual([])
    expect(fs.readFileSync(`${L}/p7y-a/docker-compose.yml`, 'utf8')).toBe(before)
    expect(fs.existsSync(`${S}/a@b.c`)).toBe(false)
    // Its containers are brought back on the old dir
    expect(d.up).toHaveBeenLastCalledWith(`${L}/p7y-a/docker-compose.yml`)
    expect(await migrateSandboxDirs(d)).toEqual(['p7y-a'])
    expect(fs.existsSync(`${L}/p7y-a`)).toBe(false)
  })

  it('once its containers use the new dir, a failure to remove the old one keeps the move (not rolled back, not moved again)', async () => {
    legacy('p7y-a')
    const { calls, d } = deps({ 'p7y-a': { status: 'exited' } })
    const realRm = fs.rmSync
    const spy = vi.spyOn(fs, 'rmSync').mockImplementation(((p: fs.PathLike, o?: fs.RmOptions) => {
      if (String(p) === `${L}/p7y-a`) throw Object.assign(new Error(`EACCES: permission denied, rmdir '${p}'`), { code: 'EACCES' })
      return realRm(p, o)
    }) as typeof fs.rmSync)
    try {
      expect(await migrateSandboxDirs(d)).toEqual(['p7y-a'])
    } finally { spy.mockRestore() }
    expect(fs.existsSync(`${S}/a@b.c/p7y-a/docker-compose.yml`)).toBe(true)
    expect(fs.existsSync(`${L}/p7y-a/docker-compose.yml`)).toBe(false)
    expect(await migrateSandboxDirs(d)).toEqual([])
    expect(calls).toEqual([`create ${S}/a@b.c/p7y-a/docker-compose.yml`])
  })

  it('replaces a target left over by an interrupted earlier move', async () => {
    legacy('p7y-a')
    fs.mkdirSync(`${S}/a@b.c/p7y-a`, { recursive: true })
    fs.writeFileSync(`${S}/a@b.c/p7y-a/stale`, 'x')
    const { d } = deps()
    expect(await migrateSandboxDirs(d)).toEqual(['p7y-a'])
    expect(fs.existsSync(`${S}/a@b.c/p7y-a/stale`)).toBe(false)
    expect(fs.existsSync(`${S}/a@b.c/p7y-a/certs/server/ca.pem`)).toBe(true)
  })

  it('moves nothing when the host directory cannot be told, and leaves a dir without a compose file alone', async () => {
    legacy('p7y-a')
    fs.mkdirSync(`${L}/p7y-junk`)
    const { d } = deps()
    expect(await migrateSandboxDirs({ ...d, hostDir: async () => '/opt/sandboxes' })).toEqual([])
    expect(fs.existsSync(`${L}/p7y-a/docker-compose.yml`)).toBe(true)
    expect(await migrateSandboxDirs(d)).toEqual(['p7y-a'])
    expect(fs.existsSync(`${L}/p7y-junk`)).toBe(true)
  })
})

describe('migrateArchives', () => {
  const archive = (n: string, manifest: Record<string, unknown> | null, label?: string) => {
    fs.mkdirSync(`${A}/${n}/config`, { recursive: true })
    if (manifest) fs.writeFileSync(`${A}/${n}/manifest.json`, JSON.stringify(manifest))
    if (label) fs.writeFileSync(`${A}/${n}/config/docker-compose.yml`, `      p7y.owner: ${label}\n`)
  }
  it("moves each archive under its owner's directory: manifest owner, else the compose label, else admin; leaves the rest", () => {
    archive('p7y-a-2026', { name: 'p7y-a', owner: 'Ann@x' })
    archive('p7y-b-2026', { name: 'p7y-b' }, 'bob@x')
    archive('p7y-c-2026', { name: 'p7y-c' })
    fs.mkdirSync(`${A}/_orphan-volumes-2026`)
    expect(migrateArchives(() => {}).sort()).toEqual(['p7y-a-2026', 'p7y-b-2026', 'p7y-c-2026'])
    expect(fs.existsSync(`${A}/ann@x/p7y-a-2026/manifest.json`)).toBe(true)
    expect(fs.existsSync(`${A}/bob@x/p7y-b-2026/manifest.json`)).toBe(true)
    expect(fs.existsSync(`${A}/admin/p7y-c-2026/manifest.json`)).toBe(true)
    expect(fs.existsSync(`${A}/_orphan-volumes-2026`)).toBe(true)
    // Owner directories are not archives: a second run moves nothing
    expect(migrateArchives(() => {})).toEqual([])
  })
})

describe('migrateSandboxDirs review fixes', () => {
  it('a target left by an earlier move that completed is used as it is (not overwritten by the stale old dir)', async () => {
    legacy('p7y-a')
    fs.mkdirSync(`${S}/a@b.c/p7y-a/certs/server`, { recursive: true })
    fs.writeFileSync(`${S}/a@b.c/p7y-a/certs/server/ca.pem`, 'NEW')
    fs.writeFileSync(`${S}/a@b.c/p7y-a/docker-compose.yml`, compose('C:/new/opt/sandboxes/a@b.c', 'p7y-a'))
    const { calls, d } = deps({ 'p7y-a': { status: 'running' } })
    expect(await migrateSandboxDirs(d)).toEqual(['p7y-a'])
    expect(fs.readFileSync(`${S}/a@b.c/p7y-a/certs/server/ca.pem`, 'utf8')).toBe('NEW')
    expect(calls).toEqual([`up ${S}/a@b.c/p7y-a/docker-compose.yml`])
    expect(fs.existsSync(`${L}/p7y-a/docker-compose.yml`)).toBe(false)
  })

  it('never shows a half-copied target: the copy goes to a hidden staging dir first', async () => {
    legacy('p7y-a')
    const seen: string[] = []
    const realCp = fs.cpSync
    const spy = vi.spyOn(fs, 'cpSync').mockImplementation(((s: string, t: string, o?: fs.CopySyncOptions) => { seen.push(String(t)); return realCp(s, t, o) }) as typeof fs.cpSync)
    try { await migrateSandboxDirs(deps().d) } finally { spy.mockRestore() }
    expect(seen).toEqual([`${S}/a@b.c/.p7y-a.moving`])
    expect(fs.existsSync(`${S}/a@b.c/.p7y-a.moving`)).toBe(false)
  })

  it('a cleanup error after a failed recreate does not escape: the containers go back on the old dir, the others still move', async () => {
    legacy('p7y-a'); legacy('p7y-b')
    const { d } = deps({ 'p7y-a': { status: 'running' } })
    d.up.mockRejectedValueOnce(new Error('boom'))
    const realRm = fs.rmSync
    let once = true
    const spy = vi.spyOn(fs, 'rmSync').mockImplementation(((p: fs.PathLike, o?: fs.RmOptions) => {
      if (once && String(p) === `${S}/a@b.c/p7y-a` && fs.existsSync(p)) { once = false; throw new Error("EBUSY") }
      return realRm(p, o)
    }) as typeof fs.rmSync)
    let out: string[] = []
    try { out = await migrateSandboxDirs(d) } finally { spy.mockRestore() }
    expect(out).toEqual(['p7y-b'])
    expect(d.up).toHaveBeenCalledWith(`${L}/p7y-a/docker-compose.yml`)
  })

  it('keeps a sandbox whose mounts it cannot rewrite in the old layout', async () => {
    fs.mkdirSync(`${L}/p7y-x`, { recursive: true })
    fs.writeFileSync(`${L}/p7y-x/docker-compose.yml`, 'services:\n  sandbox:\n    volumes:\n      - C:/old/opt/users/p7y-x/authorized_keys:/k:ro\n')
    const { d } = deps()
    expect(await migrateSandboxDirs(d)).toEqual([])
    expect(fs.existsSync(`${L}/p7y-x/docker-compose.yml`)).toBe(true)
  })

  it('moves nothing when opt/sandboxes is not a mount of its own (files would land in the container)', async () => {
    legacy('p7y-a')
    const { d } = deps()
    expect(await migrateSandboxDirs({ ...d, mounted: () => false })).toEqual([])
    expect(fs.existsSync(`${L}/p7y-a/docker-compose.yml`)).toBe(true)
  })
})
