import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('../../services/compose', () => ({
  composeUp: vi.fn().mockResolvedValue(undefined),
  composeCreate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../services/docker', () => ({ getSandboxState: vi.fn() }))

import { routedDomain, withAppsDomain, withRememberedHosts, migrateAppsDomain } from '../../services/appsDomainMigration'
import { composeUp, composeCreate } from '../../services/compose'
import { getSandboxState } from '../../services/docker'

// What a runtime generates (quoted, as in runtimes/*.yaml) and the same after yaml.dump (unquoted)
const compose = (raw: string, domain: string, quoted = true) => {
  const q = (s: string) => quoted ? `"${s}"` : s
  return `services:
  sandbox:
    environment:
      FRP_SERVER_ADDR: ${q(`p9m-${raw}-frps`)}
      BASE_DOMAIN: ${q(domain)}
  socat:
    labels:
      traefik.http.routers.frps-p9m-${raw}.rule: ${q(`HostRegexp(\`^${raw}-[a-z0-9-]+[.]${domain}$\`)`)}
      traefik.http.routers.frps-p9m-${raw}.entrypoints: web,websecure
`
}
const state = (status: string, error = '') =>
  ({ name: 'x', status, finishedAt: '', deepSleepAfter: '7d', staleNetwork: false, error })

function usersDir(sandboxes: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p9m-apps-'))
  for (const [name, domain] of Object.entries(sandboxes)) {
    fs.mkdirSync(`${dir}/${name}`)
    fs.writeFileSync(`${dir}/${name}/docker-compose.yml`, compose(name.slice(4), domain))
  }
  return dir
}
const read = (dir: string, name: string) => fs.readFileSync(`${dir}/${name}/docker-compose.yml`, 'utf8')

describe('routedDomain / withAppsDomain', () => {
  it("finds the domain the sandbox's router answers under", () => {
    expect(routedDomain(compose('shop', 'p9m.dev'), 'shop')).toBe('p9m.dev')
    expect(routedDomain(compose('shop', 'lvh.me', false), 'shop')).toBe('lvh.me')
    expect(routedDomain(compose('shop', 'p9m.dev'), 'sho')).toBeNull() // another sandbox's raw name
    expect(routedDomain('services:\n  sandbox:\n    image: x\n', 'shop')).toBeNull() // a runtime without the router
  })

  it('moves the router and BASE_DOMAIN, quoted or not, and nothing else', () => {
    expect(withAppsDomain(compose('shop', 'p9m.dev'), 'shop', 'p9m.dev', 'p9m.app')).toBe(compose('shop', 'p9m.app'))
    expect(withAppsDomain(compose('shop', 'p9m.dev', false), 'shop', 'p9m.dev', 'p9m.app')).toBe(compose('shop', 'p9m.app', false))
    const crlf = compose('shop', 'p9m.dev').replace(/\n/g, '\r\n')
    expect(withAppsDomain(crlf, 'shop', 'p9m.dev', 'p9m.app')).toBe(compose('shop', 'p9m.app').replace(/\n/g, '\r\n'))
    // A registry address under the old domain is Purgatorium's own: it stays
    const withRegistry = `${compose('shop', 'p9m.dev')}      REGISTRY: registry.p9m.dev\n`
    expect(withAppsDomain(withRegistry, 'shop', 'p9m.dev', 'p9m.app')).toContain('REGISTRY: registry.p9m.dev')
  })
})

describe('withRememberedHosts', () => {
  it("moves the sandbox's own addresses, not another's or Purgatorium's", () => {
    const apps = '[{"url":"shop-web.p9m.dev","port":80},{"url":"shopx-web.p9m.dev"},{"r":"registry.p9m.dev"},{"u":"shop-web.p9m.devices.com"}]'
    expect(withRememberedHosts(apps, 'shop', 'p9m.dev', 'p9m.app'))
      .toBe('[{"url":"shop-web.p9m.app","port":80},{"url":"shopx-web.p9m.dev"},{"r":"registry.p9m.dev"},{"u":"shop-web.p9m.devices.com"}]')
  })
})

describe('migrateAppsDomain', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rewrites the sandboxes under another domain; starts running and failed ones, recreates asleep ones stopped, only rewrites deep-sleeping ones', async () => {
    const dir = usersDir({ 'p9m-run': 'p9m.dev', 'p9m-failed': 'p9m.dev', 'p9m-sleep': 'p9m.dev', 'p9m-deep': 'p9m.dev', 'p9m-new': 'p9m.app' })
    vi.mocked(getSandboxState).mockImplementation(async name => ({
      'p9m-run': state('running'),
      'p9m-failed': state('exited', 'some error'),
      'p9m-sleep': state('exited'),
      'p9m-new': state('running'),
    } as Record<string, ReturnType<typeof state>>)[name] ?? null)

    const migrated = await migrateAppsDomain(dir, 'p9m.app')

    expect(migrated.sort()).toEqual(['p9m-deep', 'p9m-failed', 'p9m-run', 'p9m-sleep'])
    for (const n of [...migrated, 'p9m-new']) expect(read(dir, n)).toBe(compose(n.slice(4), 'p9m.app'))
    expect(vi.mocked(composeUp).mock.calls.map(c => c[0]).sort())
      .toEqual([`${dir}/p9m-failed/docker-compose.yml`, `${dir}/p9m-run/docker-compose.yml`])
    expect(composeCreate).toHaveBeenCalledTimes(1)
    expect(composeCreate).toHaveBeenCalledWith(`${dir}/p9m-sleep/docker-compose.yml`)
  })

  it('the addresses an asleep sandbox remembers move too', async () => {
    const dir = usersDir({ 'p9m-sleep': 'p9m.dev' })
    fs.writeFileSync(`${dir}/p9m-sleep/apps.json`, '[{"url":"sleep-web.p9m.dev","port":80}]')
    fs.writeFileSync(`${dir}/p9m-sleep/tcp.json`, '[{"host":"sleep-web-tcp.p9m.dev","port":5432}]')
    vi.mocked(getSandboxState).mockResolvedValue(state('exited'))
    await migrateAppsDomain(dir, 'p9m.app')
    expect(fs.readFileSync(`${dir}/p9m-sleep/apps.json`, 'utf8')).toBe('[{"url":"sleep-web.p9m.app","port":80}]')
    expect(fs.readFileSync(`${dir}/p9m-sleep/tcp.json`, 'utf8')).toBe('[{"host":"sleep-web-tcp.p9m.app","port":5432}]')
  })

  it('nothing to do when every sandbox is under the apps domain', async () => {
    const dir = usersDir({ 'p9m-a': 'lvh.me' })
    expect(await migrateAppsDomain(dir, 'lvh.me')).toEqual([])
    expect(composeUp).not.toHaveBeenCalled()
  })

  it('a failed recreate puts the file back, for the next start to try again', async () => {
    const dir = usersDir({ 'p9m-run': 'p9m.dev' })
    vi.mocked(getSandboxState).mockResolvedValue(state('running'))
    vi.mocked(composeUp).mockRejectedValueOnce(new Error('compose failed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await migrateAppsDomain(dir, 'p9m.app')).toEqual([])
    expect(read(dir, 'p9m-run')).toBe(compose('run', 'p9m.dev'))
  })
})
