import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import yaml from 'js-yaml'

vi.mock('../../services/compose', () => ({ composeUpService: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../services/docker', () => ({ listManagedContainers: vi.fn() }))

import { withSlowerSocatCheck, migrateSocatCheck } from '../../services/socatHealthcheck'
import { composeUpService } from '../../services/compose'
import { listManagedContainers } from '../../services/docker'
import { sandboxMeta } from '../helpers/sandboxMeta'
import { loadRuntime } from '../../services/runtimeLoader'

// What sandboxes were created with until now: every 2 s, every 0.5 s while starting
const OLD = { test: ['CMD-SHELL', 'true'], interval: '2s', timeout: '2s', retries: 60, start_period: '60s', start_interval: '500ms' }
const compose = (healthcheck: object = OLD) => yaml.dump({ services: { sandbox: { image: 'dind' }, socat: { image: 'alpine/socat', healthcheck } } }, { lineWidth: -1 })
const checkOf = (text: string) => (yaml.load(text) as { services: { socat: { healthcheck: Record<string, unknown> } } }).services.socat.healthcheck

describe('withSlowerSocatCheck', () => {
  it("the runtimes' old check: every 10 s once up, gone within 2 minutes as before, still every 0.5 s while starting", () => {
    expect(checkOf(withSlowerSocatCheck(compose())!)).toEqual({ ...OLD, interval: '10s', retries: 12 })
  })

  it('gives old sandboxes what the runtimes give new ones', () => {
    for (const r of ['dind', 'sysbox']) {
      const { test: _, ...check } = (loadRuntime(r, path.join(process.cwd(), 'runtimes')).docker_compose.services as Record<string, { healthcheck: Record<string, unknown> }>).socat.healthcheck
      const { test: __, ...migrated } = checkOf(withSlowerSocatCheck(compose())!)
      expect(check, r).toEqual(migrated)
    }
  })

  it('leaves a migrated check, an edited one and one without start_interval (an engine below 25) alone', () => {
    expect(withSlowerSocatCheck(compose({ ...OLD, interval: '10s', retries: 12 }))).toBeNull()
    expect(withSlowerSocatCheck(compose({ ...OLD, interval: '5s' }))).toBeNull()
    const { start_interval: _, ...old } = OLD
    expect(withSlowerSocatCheck(compose(old))).toBeNull()
    expect(withSlowerSocatCheck('services: { frps: { image: frps } }')).toBeNull()
    expect(withSlowerSocatCheck(': not yaml')).toBeNull()
  })
})

describe('migrateSocatCheck', () => {
  beforeEach(() => { vi.clearAllMocks() })
  function dir(sandboxes: Record<string, string>): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-socat-'))
    for (const [n, text] of Object.entries(sandboxes)) {
      fs.mkdirSync(`${d}/${n}`)
      fs.writeFileSync(`${d}/${n}/docker-compose.yml`, text)
    }
    return d
  }

  it('recreates socat: started if the sandbox runs, created if it sleeps, only the file in deep sleep', async () => {
    const d = dir({ 'p7y-run': compose(), 'p7y-sleep': compose(), 'p7y-deep': compose() })
    vi.mocked(listManagedContainers).mockResolvedValue([sandboxMeta({ name: 'p7y-run', status: 'running' }), sandboxMeta({ name: 'p7y-sleep', status: 'exited' })])
    expect((await migrateSocatCheck(d)).sort()).toEqual(['p7y-deep', 'p7y-run', 'p7y-sleep'])
    for (const n of ['p7y-run', 'p7y-sleep', 'p7y-deep']) expect(checkOf(fs.readFileSync(`${d}/${n}/docker-compose.yml`, 'utf8')).interval).toBe('10s')
    expect(vi.mocked(composeUpService).mock.calls.map(c => [path.basename(path.dirname(c[0])), c[1], c[2]]).sort())
      .toEqual([['p7y-run', 'socat', true], ['p7y-sleep', 'socat', false]])
  })

  it('a failed recreate puts the file back, for the next start', async () => {
    const d = dir({ 'p7y-run': compose() })
    vi.mocked(listManagedContainers).mockResolvedValue([sandboxMeta({ name: 'p7y-run', status: 'running' })])
    vi.mocked(composeUpService).mockRejectedValueOnce(new Error('daemon busy'))
    expect(await migrateSocatCheck(d)).toEqual([])
    expect(fs.readFileSync(`${d}/p7y-run/docker-compose.yml`, 'utf8')).toBe(compose())
  })
})
