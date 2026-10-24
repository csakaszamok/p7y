import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import yaml from 'js-yaml'

vi.stubEnv('SESSION_SECRET', 'test-secret')
vi.stubEnv('ADMIN_TOKEN', 'admin-secret')

const sandboxes = [
  { name: 'p7y-a1', owner: 'alice@example.com', status: 'running' },
  { name: 'p7y-b1', owner: 'bob@example.com', status: 'deep_sleep' },
]
vi.mock('../../../services/sandbox', () => ({
  sandboxService: {
    getSandbox: vi.fn(async (name: string) => {
      const s = sandboxes.find(x => x.name === name)
      if (!s) throw new Error(`Sandbox not found: ${name}`)
      return s
    }),
  },
}))
vi.mock('../../../services/tokens', () => ({
  resolveToken: vi.fn((t: string) => t === 'p7y_alice' ? { owner: 'alice@example.com', sandbox: null } : t === 'p7y_scoped' ? { owner: 'alice@example.com', sandbox: 'p7y-a1' } : null),
}))
// The compose files live in a temp dir; the container recreate is recorded, Docker never runs
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-mounts-route-'))
const recreate = vi.fn(async (_f: string, _start: boolean) => {})
vi.mock('../../../services/hostMounts', async orig => {
  const real = await orig<typeof import('../../../services/hostMounts')>()
  const deps = { composePath: (n: string) => `${dir}/${n}.yml`, recreate }
  return {
    ...real,
    mountsOf: (name: string) => real.mountsOf(name, `${dir}/${name}.yml`),
    addMount: (name: string, status: string, input: unknown) => real.addMount(name, status, input, deps),
    removeMount: (name: string, status: string, target: string) => real.removeMount(name, status, target, deps),
  }
})
const { default: get } = await import('../../../routes/sandboxes/[name]/mounts/GET')
const { default: post } = await import('../../../routes/sandboxes/[name]/mounts/POST')
const { default: del } = await import('../../../routes/sandboxes/[name]/mounts/DELETE')

const COMPOSE = yaml.dump({
  services: { sandbox: { image: 'dind', volumes: ['/h/p7y-a1/certs:/certs', 'docker_data:/var/lib/docker', 'sandbox_opt:/opt'], labels: { 'p7y.name': 'p7y-a1' } } },
  volumes: { docker_data: null, sandbox_opt: null },
})
const req = (method: string, name: string, token: string | null, body?: unknown, query = '') => new Request(`http://p7y.lvh.me/sandboxes/${name}/mounts${query}`, {
  method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
})
const composeOf = (n: string) => yaml.load(fs.readFileSync(`${dir}/${n}.yml`, 'utf8')) as { services: { sandbox: { volumes: unknown[]; labels: Record<string, string> } } }

describe('/sandboxes/<name>/mounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('HOST_MOUNT_ROOTS', '/srv/shared,/data/projects')
    for (const s of sandboxes) fs.writeFileSync(`${dir}/${s.name}.yml`, COMPOSE)
  })

  it('the admin adds a mount: into the compose file and its label, the sandbox recreated (running: started)', async () => {
    const res = await post(req('POST', 'p7y-a1', 'admin-secret', { host: '/srv/shared/team', readonly: true }))
    expect(res.status).toBe(200)
    const m = { host: '/srv/shared/team', target: '/mnt/team', readonly: true }
    expect(await res.json()).toEqual({ name: 'p7y-a1', mounts: [m] })
    const sb = composeOf('p7y-a1').services.sandbox
    expect(sb.volumes).toContainEqual({ type: 'bind', source: '/srv/shared/team', target: '/mnt/team', read_only: true, bind: { create_host_path: false } })
    expect(JSON.parse(sb.labels['p7y.mounts'])).toEqual([m])
    expect(recreate).toHaveBeenCalledWith(`${dir}/p7y-a1.yml`, true)
    // A second one is added next to it; the same target again is refused
    expect((await post(req('POST', 'p7y-a1', 'admin-secret', { host: '/data/projects', target: '/work' }))).status).toBe(200)
    const dup = await post(req('POST', 'p7y-a1', 'admin-secret', { host: '/data/projects/x', target: '/work/' }))
    expect(dup.status).toBe(400)
    expect((await dup.json()).error).toMatch(/already/)
    expect((await (await get(req('GET', 'p7y-a1', 'admin-secret'))).json()).mounts).toHaveLength(2)
  })

  it('the admin removes one by its target; an unknown target is a 404', async () => {
    await post(req('POST', 'p7y-a1', 'admin-secret', { host: '/srv/shared' }))
    await post(req('POST', 'p7y-a1', 'admin-secret', { host: '/data/projects' }))
    recreate.mockClear()
    const res = await del(req('DELETE', 'p7y-a1', 'admin-secret', undefined, '?target=%2Fmnt%2Fshared'))
    expect(res.status).toBe(200)
    expect((await res.json()).mounts).toEqual([{ host: '/data/projects', target: '/mnt/projects', readonly: false }])
    expect(recreate).toHaveBeenCalledWith(`${dir}/p7y-a1.yml`, true)
    expect(composeOf('p7y-a1').services.sandbox.volumes.filter(v => typeof v === 'object')).toHaveLength(1)
    expect((await del(req('DELETE', 'p7y-a1', 'admin-secret', undefined, '?target=/mnt/shared'))).status).toBe(404)
    expect((await del(req('DELETE', 'p7y-a1', 'admin-secret'))).status).toBe(400)
  })

  it('deep sleep: only the compose file changes', async () => {
    expect((await post(req('POST', 'p7y-b1', 'admin-secret', { host: '/srv/shared' }))).status).toBe(200)
    expect(recreate).not.toHaveBeenCalled()
    expect(composeOf('p7y-b1').services.sandbox.labels['p7y.mounts']).toBeDefined()
  })

  it('only the admin adds or removes; the owner (and a token for the sandbox) may list them', async () => {
    const add = await post(req('POST', 'p7y-a1', 'p7y_alice', { host: '/srv/shared' }))
    expect(add.status).toBe(403)
    expect((await add.json()).error).toMatch(/administrator/)
    expect((await post(req('POST', 'p7y-a1', 'p7y_scoped', { host: '/srv/shared' }))).status).toBe(403)
    expect((await del(req('DELETE', 'p7y-a1', 'p7y_alice', undefined, '?target=/mnt/shared'))).status).toBe(403)
    expect(recreate).not.toHaveBeenCalled()
    await post(req('POST', 'p7y-a1', 'admin-secret', { host: '/srv/shared' }))
    for (const t of ['p7y_alice', 'p7y_scoped']) {
      const list = await get(req('GET', 'p7y-a1', t))
      expect(list.status, t).toBe(200)
      expect(await list.json()).toEqual({ name: 'p7y-a1', enabled: true, mounts: [{ host: '/srv/shared', target: '/mnt/shared', readonly: false }] })
    }
    // Someone else's sandbox: as if it did not exist
    expect((await get(req('GET', 'p7y-b1', 'p7y_alice'))).status).toBe(404)
    expect((await get(req('GET', 'p7y-a1', null))).status).toBe(401)
  })

  it('the admin also sees the allowed roots', async () => {
    expect(await (await get(req('GET', 'p7y-a1', 'admin-secret'))).json()).toEqual({ name: 'p7y-a1', enabled: true, roots: ['/srv/shared', '/data/projects'], mounts: [] })
  })

  it('HOST_MOUNT_ROOTS unset: adding is refused (409); the ones already there can still be removed', async () => {
    await post(req('POST', 'p7y-a1', 'admin-secret', { host: '/srv/shared' }))
    vi.stubEnv('HOST_MOUNT_ROOTS', '')
    const res = await post(req('POST', 'p7y-a1', 'admin-secret', { host: '/srv/shared/x' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/HOST_MOUNT_ROOTS/)
    expect((await (await get(req('GET', 'p7y-a1', 'admin-secret'))).json()).enabled).toBe(false)
    expect((await del(req('DELETE', 'p7y-a1', 'admin-secret', undefined, '?target=/mnt/shared'))).status).toBe(200)
  })

  it('400s a path outside the roots or a bad target, 404s a missing sandbox', async () => {
    expect((await post(req('POST', 'p7y-a1', 'admin-secret', { host: '/srv/shared2' }))).status).toBe(400)
    expect((await post(req('POST', 'p7y-a1', 'admin-secret', { host: '/srv/shared', target: '/var/lib/docker' }))).status).toBe(400)
    expect((await post(req('POST', 'p7y-a1', 'admin-secret', { host: '/srv/shared', target: '/etc/x' }))).status).toBe(400)
    expect((await post(req('POST', 'p7y-zz', 'admin-secret', { host: '/srv/shared' }))).status).toBe(404)
    expect(recreate).not.toHaveBeenCalled()
  })

  it("Docker refuses the mount: 409 with Docker's words, the compose file unchanged", async () => {
    recreate.mockRejectedValueOnce(Object.assign(new Error('Command failed'), { stderr: 'Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /srv/shared/gone' }))
    const res = await post(req('POST', 'p7y-a1', 'admin-secret', { host: '/srv/shared/gone' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/bind source path does not exist: \/srv\/shared\/gone/)
    expect(fs.readFileSync(`${dir}/p7y-a1.yml`, 'utf8')).toBe(COMPOSE)
  })
})
