import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import yaml from 'js-yaml'
import { forgetSandboxDir } from '../../services/sandboxPaths'

vi.mock('../../services/compose', () => ({ composeUpService: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../services/project', () => ({ nudgeTraefik: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../services/docker', () => ({ listManagedContainers: vi.fn() }))

import { withWebsecure, withSocatUrl, withoutAllowNonRunning, migrateRouters } from '../../services/routerMigration'
import { composeUpService } from '../../services/compose'
import { nudgeTraefik } from '../../services/project'
import { listManagedContainers } from '../../services/docker'

const key = (name: string) => `traefik.http.routers.frps-${name}.entrypoints`
const compose = (name: string, entrypoints: string) => yaml.dump({
  services: { sandbox: { image: 'dind' }, socat: { image: 'socat', labels: { [key(name)]: entrypoints, 'traefik.enable': 'true' } } }
})
const meta = (name: string, status: string) => ({ name, template: 't', status, container_id: 'x', created_at: '' })

function usersDir(sandboxes: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ldr-users-'))
  for (const [name, entrypoints] of Object.entries(sandboxes)) {
    fs.mkdirSync(`${dir}/${name}`)
    fs.writeFileSync(`${dir}/${name}/docker-compose.yml`, compose(name, entrypoints))
  }
  return dir
}
const entrypointsIn = (dir: string, name: string) =>
  (yaml.load(fs.readFileSync(`${dir}/${name}/docker-compose.yml`, 'utf8')) as { services: { socat: { labels: Record<string, string> } } }).services.socat.labels[key(name)]

describe('withWebsecure', () => {
  it('adds websecure to a web-only sandbox router and keeps the other labels', () => {
    const out = withWebsecure(compose('leander-a', 'web'), 'leander-a')!
    const labels = (yaml.load(out) as { services: { socat: { labels: Record<string, string> } } }).services.socat.labels
    expect(labels[key('leander-a')]).toBe('web,websecure')
    expect(labels['traefik.enable']).toBe('true')
  })

  it('leaves current or unknown files alone (null)', () => {
    expect(withWebsecure(compose('leander-a', 'web,websecure'), 'leander-a')).toBeNull()
    expect(withWebsecure(yaml.dump({ services: { sandbox: {} } }), 'leander-a')).toBeNull()
    expect(withWebsecure(': not yaml [', 'leander-a')).toBeNull()
  })
})

describe('migrateRouters', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rewrites web-only sandboxes; recreates socat started when running, stopped when asleep, not at all in deep sleep', async () => {
    const dir = usersDir({ 'leander-run': 'web', 'leander-sleep': 'web', 'leander-deep': 'web', 'leander-new': 'web,websecure' })
    vi.mocked(listManagedContainers).mockResolvedValue([meta('leander-run', 'running'), meta('leander-sleep', 'exited'), meta('leander-new', 'running')])
    const migrated = await migrateRouters(dir)
    expect(migrated.sort()).toEqual(['leander-deep', 'leander-run', 'leander-sleep'])
    for (const n of ['leander-run', 'leander-sleep', 'leander-deep']) expect(entrypointsIn(dir, n)).toBe('web,websecure')
    expect(composeUpService).toHaveBeenCalledTimes(2)
    expect(composeUpService).toHaveBeenCalledWith(`${dir}/leander-run/docker-compose.yml`, 'socat', true)
    expect(composeUpService).toHaveBeenCalledWith(`${dir}/leander-sleep/docker-compose.yml`, 'socat', false)
    expect(nudgeTraefik).toHaveBeenCalledTimes(1)
  })

  it('does nothing when every sandbox is current', async () => {
    const dir = usersDir({ 'leander-new': 'web,websecure' })
    vi.mocked(listManagedContainers).mockResolvedValue([meta('leander-new', 'running')])
    expect(await migrateRouters(dir)).toEqual([])
    expect(composeUpService).not.toHaveBeenCalled()
    expect(nudgeTraefik).not.toHaveBeenCalled()
  })

  it('keeps going when one sandbox fails', async () => {
    const dir = usersDir({ 'leander-a': 'web', 'leander-b': 'web' })
    vi.mocked(listManagedContainers).mockResolvedValue([meta('leander-a', 'running'), meta('leander-b', 'running')])
    vi.mocked(composeUpService).mockRejectedValueOnce(new Error('boom'))
    expect((await migrateRouters(dir)).length).toBe(1)
    expect(composeUpService).toHaveBeenCalledTimes(2)
    // the failed one is put back, so the next start retries it
    expect(['leander-a', 'leander-b'].map(n => entrypointsIn(dir, n)).sort()).toEqual(['web', 'web,websecure'])
  })

  it('returns nothing when the users dir is missing', async () => {
    vi.mocked(listManagedContainers).mockResolvedValue([])
    expect(await migrateRouters('/nonexistent/users')).toEqual([])
  })
})

const portKey = (name: string) => `traefik.http.services.frps-${name}.loadbalancer.server.port`
const urlKey = (name: string) => `traefik.http.services.frps-${name}.loadbalancer.server.url`
const withPort = (name: string, entrypoints = 'web,websecure') => yaml.dump({
  services: { sandbox: { image: 'dind' }, socat: { image: 'socat', labels: { [key(name)]: entrypoints, [portKey(name)]: '8080', 'traefik.enable': 'true' } } }
})
const socatLabels = (text: string) => (yaml.load(text) as { services: { socat: { labels: Record<string, string> } } }).services.socat.labels

describe('withSocatUrl', () => {
  it("points the sandbox's service at socat by name instead of the container's port", () => {
    const labels = socatLabels(withSocatUrl(withPort('p7y-a'), 'p7y-a')!)
    expect(labels[urlKey('p7y-a')]).toBe('http://p7y-a-socat:8080')
    expect(labels[portKey('p7y-a')]).toBeUndefined()
    expect(labels['traefik.enable']).toBe('true')
  })
  it('leaves current or unknown files alone (null)', () => {
    expect(withSocatUrl(withSocatUrl(withPort('p7y-a'), 'p7y-a')!, 'p7y-a')).toBeNull()
    expect(withSocatUrl(compose('p7y-a', 'web,websecure'), 'p7y-a')).toBeNull()
    expect(withSocatUrl(': not yaml [', 'p7y-a')).toBeNull()
  })
})

describe('migrateRouters: socat by name', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rewrites sandboxes on the port label, one recreate per sandbox even when both changes apply', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-users-'))
    for (const [n, text] of [['p7y-sleep', withPort('p7y-sleep')], ['p7y-both', withPort('p7y-both', 'web')]] as const) {
      fs.mkdirSync(`${dir}/${n}`); fs.writeFileSync(`${dir}/${n}/docker-compose.yml`, text)
    }
    vi.mocked(listManagedContainers).mockResolvedValue([meta('p7y-sleep', 'exited'), meta('p7y-both', 'running')])
    expect((await migrateRouters(dir)).sort()).toEqual(['p7y-both', 'p7y-sleep'])
    const both = socatLabels(fs.readFileSync(`${dir}/p7y-both/docker-compose.yml`, 'utf8'))
    expect(both[key('p7y-both')]).toBe('web,websecure')
    expect(both[urlKey('p7y-both')]).toBe('http://p7y-both-socat:8080')
    expect(composeUpService).toHaveBeenCalledTimes(2)
    expect(composeUpService).toHaveBeenCalledWith(`${dir}/p7y-sleep/docker-compose.yml`, 'socat', false)
    expect(composeUpService).toHaveBeenCalledWith(`${dir}/p7y-both/docker-compose.yml`, 'socat', true)
  })
})

describe('withoutAllowNonRunning', () => {
  const allow = (name: string) => yaml.dump({ services: { socat: { labels: { [key(name)]: 'web,websecure', 'traefik.docker.allownonrunning': 'true' } } } })
  it('drops the label; leaves current or unknown files alone', () => {
    expect(socatLabels(withoutAllowNonRunning(allow('p7y-a'), 'p7y-a')!)['traefik.docker.allownonrunning']).toBeUndefined()
    expect(withoutAllowNonRunning(compose('p7y-a', 'web,websecure'), 'p7y-a')).toBeNull()
    expect(withoutAllowNonRunning(': not yaml [', 'p7y-a')).toBeNull()
  })
  it('migrateRouters: all three changes in one rewrite and one recreate', async () => {
    vi.clearAllMocks()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-users-'))
    const text = yaml.dump({ services: { socat: { labels: { [key('p7y-old')]: 'web', 'traefik.http.services.frps-p7y-old.loadbalancer.server.port': '8080', 'traefik.docker.allownonrunning': 'true' } } } })
    fs.mkdirSync(`${dir}/p7y-old`); fs.writeFileSync(`${dir}/p7y-old/docker-compose.yml`, text)
    vi.mocked(listManagedContainers).mockResolvedValue([meta('p7y-old', 'exited')])
    expect(await migrateRouters(dir)).toEqual(['p7y-old'])
    const labels = socatLabels(fs.readFileSync(`${dir}/p7y-old/docker-compose.yml`, 'utf8'))
    expect(labels).toMatchObject({ [key('p7y-old')]: 'web,websecure', 'traefik.http.services.frps-p7y-old.loadbalancer.server.url': 'http://p7y-old-socat:8080' })
    expect(labels['traefik.docker.allownonrunning']).toBeUndefined()
    expect(composeUpService).toHaveBeenCalledTimes(1)
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

describe('migrateRouters without a directory', () => {
  it("migrates sandboxes in their owner's directory", async () => {
    vi.mocked(listManagedContainers).mockResolvedValue([])
    await inOwnerLayout(root => {
      fs.mkdirSync(`${root}/a@b.c/p7y-own`, { recursive: true })
      fs.writeFileSync(`${root}/a@b.c/p7y-own/docker-compose.yml`, compose('p7y-own', 'web'))
    }, async root => {
      expect(await migrateRouters()).toEqual(['p7y-own'])
      expect(entrypointsIn(`${root}/a@b.c`, 'p7y-own')).toBe('web,websecure')
    })
  })
})
