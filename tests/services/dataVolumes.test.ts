import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import yaml from 'js-yaml'
import { forgetSandboxDir } from '../../services/sandboxPaths'
import { DATA_PATHS, withDataVolumes, migrateDataVolumes, measureBinds } from '../../services/dataVolumes'

type Doc = { services: { sandbox: { volumes: string[] } }; volumes?: Record<string, unknown> }
const compose = (extra: string[] = []) => yaml.dump({
  services: { sandbox: { image: 'dind', volumes: ['/x/certs:/certs', 'docker_data:/var/lib/docker', ...extra] }, frps: { image: 'frps' } },
  volumes: { docker_data: null },
})
const usersDir = (sandboxes: Record<string, string>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-dv-'))
  for (const [n, text] of Object.entries(sandboxes)) { fs.mkdirSync(`${dir}/${n}`); fs.writeFileSync(`${dir}/${n}/docker-compose.yml`, text) }
  return dir
}

describe('withDataVolumes', () => {
  it('mounts a named volume on /opt, /root, /home and /srv of the sandbox, and declares them', () => {
    expect(DATA_PATHS).toEqual(['/opt', '/root', '/home', '/srv'])
    const doc = yaml.load(withDataVolumes(compose())!) as Doc
    expect(doc.services.sandbox.volumes).toEqual(expect.arrayContaining(['sandbox_opt:/opt', 'sandbox_root:/root', 'sandbox_home:/home', 'sandbox_srv:/srv', 'docker_data:/var/lib/docker']))
    expect(Object.keys(doc.volumes!)).toEqual(expect.arrayContaining(['docker_data', 'sandbox_opt', 'sandbox_root', 'sandbox_home', 'sandbox_srv']))
  })
  it('leaves a migrated or unknown file alone (null)', () => {
    expect(withDataVolumes(withDataVolumes(compose())!)).toBeNull()
    expect(withDataVolumes(yaml.dump({ services: { other: {} } }))).toBeNull()
    expect(withDataVolumes(': not yaml [')).toBeNull()
  })
})

describe('migrateDataVolumes', () => {
  const deps = () => {
    const calls: string[] = []
    return {
      calls,
      d: {
        status: vi.fn(async (n: string) => ({ 'p7y-run': 'running', 'p7y-sleep': 'exited' } as Record<string, string>)[n]),
        stop: vi.fn(async (f: string) => { calls.push(`stop ${path.basename(path.dirname(f))}`) }),
        start: vi.fn(async (f: string) => { calls.push(`start ${path.basename(path.dirname(f))}`) }),
        copy: vi.fn(async (n: string) => { calls.push(`copy ${n}`) }),
        recreate: vi.fn(async (f: string, start: boolean) => {
          const migrated = fs.readFileSync(f, 'utf8').includes('sandbox_opt:/opt')
          calls.push(`recreate ${path.basename(path.dirname(f))} start=${start} migrated=${migrated}`)
        }),
        log: () => {},
      },
    }
  }

  it("running: stopped, its files copied into the volumes, then the compose file, then recreated and started", async () => {
    const dir = usersDir({ 'p7y-run': compose() })
    const { calls, d } = deps()
    expect(await migrateDataVolumes(dir, d)).toEqual(['p7y-run'])
    expect(calls).toEqual(['stop p7y-run', 'copy p7y-run', 'recreate p7y-run start=true migrated=true'])
  })

  it('asleep: copied, then recreated without starting; deep sleep: only the compose file (no container to copy from)', async () => {
    const dir = usersDir({ 'p7y-sleep': compose(), 'p7y-deep': compose() })
    const { calls, d } = deps()
    expect((await migrateDataVolumes(dir, d)).sort()).toEqual(['p7y-deep', 'p7y-sleep'])
    expect(calls).toEqual(['copy p7y-sleep', 'recreate p7y-sleep start=false migrated=true'])
    expect(fs.readFileSync(`${dir}/p7y-deep/docker-compose.yml`, 'utf8')).toContain('sandbox_opt:/opt')
  })

  it('a failed copy leaves the compose file as it was (retried at the next start) and starts a running one again', async () => {
    const dir = usersDir({ 'p7y-run': compose() })
    const before = fs.readFileSync(`${dir}/p7y-run/docker-compose.yml`, 'utf8')
    const { calls, d } = deps()
    d.copy.mockRejectedValueOnce(new Error('disk full'))
    expect(await migrateDataVolumes(dir, d)).toEqual([])
    expect(fs.readFileSync(`${dir}/p7y-run/docker-compose.yml`, 'utf8')).toBe(before)
    expect(calls).toEqual(['stop p7y-run', 'start p7y-run'])
  })

  it('does nothing for migrated sandboxes', async () => {
    const dir = usersDir({ 'p7y-run': withDataVolumes(compose())! })
    const { calls, d } = deps()
    expect(await migrateDataVolumes(dir, d)).toEqual([])
    expect(calls).toEqual([])
  })
})

describe('measureBinds', () => {
  it('every volume of the sandbox is measured, each under /d', () => {
    expect(measureBinds(['p7y-a_docker_data', 'p7y-a_sandbox_opt'])).toEqual(['p7y-a_docker_data:/d/p7y-a_docker_data:ro', 'p7y-a_sandbox_opt:/d/p7y-a_sandbox_opt:ro'])
  })
})

/** Runs fn with SANDBOXES_DIR pointing at a fresh per-owner layout made by `make` (root passed in). */
async function inOwnerLayout<T>(make: (root: string) => void, fn: (root: string) => Promise<T>): Promise<T> {
  const saved = process.env.SANDBOXES_DIR
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-owners-')).replace(/\\/g, '/')
  process.env.SANDBOXES_DIR = root
  forgetSandboxDir()
  try { make(root); return await fn(root) } finally { process.env.SANDBOXES_DIR = saved; forgetSandboxDir() }
}

describe('migrateDataVolumes without a directory', () => {
  it("migrates sandboxes in their owner's directory", async () => {
    await inOwnerLayout(root => {
      fs.mkdirSync(`${root}/admin/p7y-deep`, { recursive: true })
      fs.writeFileSync(`${root}/admin/p7y-deep/docker-compose.yml`, compose())
    }, async root => {
      const d = { status: vi.fn(async () => undefined), copy: vi.fn(), recreate: vi.fn(), log: () => {} }
      expect(await migrateDataVolumes(undefined, d)).toEqual(['p7y-deep'])
      expect(d.copy).not.toHaveBeenCalled()
      expect(fs.readFileSync(`${root}/admin/p7y-deep/docker-compose.yml`, 'utf8')).toContain('sandbox_opt:/opt')
    })
  })
})
