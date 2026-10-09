import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import yaml from 'js-yaml'

vi.mock('../../services/compose', () => ({ composeUpService: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../services/docker', () => ({ listManagedContainers: vi.fn() }))

import { frpsToml, frpsApiAuth, withFrpsApiAuth, withSocatApiAuth, migrateFrpsApiAuth } from '../../services/frpsApi'
import { composeUpService } from '../../services/compose'
import { listManagedContainers } from '../../services/docker'
import { sandboxMeta } from '../helpers/sandboxMeta'

// What sandboxes were created with until now: the frps API without a password
const OLD_TOML = 'bindPort = 7000\nvhostHTTPPort = 8080\n[auth]\ntoken = "tok"\n[webServer]\naddr = "0.0.0.0"\nport = 7500\n'
const OLD_CHECK = 'wget -qO- http://127.0.0.1:7500/api/proxy/http | grep -q online'
const compose = (test: string[] = ['CMD-SHELL', OLD_CHECK], environment?: Record<string, string>) => yaml.dump({
  services: { sandbox: { image: 'dind' }, socat: { image: 'alpine/socat', ...(environment ? { environment } : {}), healthcheck: { test, interval: '2s' } } },
}, { lineWidth: -1 })
const socatOf = (text: string) => (yaml.load(text) as { services: { socat: { environment?: Record<string, string>; healthcheck: { test: string[] } } } }).services.socat

describe('the frps API password', () => {
  it('a new sandbox: frps.toml with a user and password for its API', () => {
    const toml = frpsToml('tok', 'pw123')
    expect(toml).toContain('token = "tok"')
    expect(toml).toMatch(/\[webServer\][\s\S]*user = "p7y"[\s\S]*password = "pw123"/)
    expect(frpsApiAuth(toml)).toBe('p7y:pw123')
  })
  it('no password in an old frps.toml', () => {
    expect(frpsApiAuth(OLD_TOML)).toBeNull()
  })
  it('adds it to an old frps.toml, once', () => {
    const toml = withFrpsApiAuth(OLD_TOML, 'pw123')!
    expect(frpsApiAuth(toml)).toBe('p7y:pw123')
    expect(toml).toContain('token = "tok"')
    expect(withFrpsApiAuth(toml, 'other')).toBeNull()
  })
})

describe("socat's health check with the password", () => {
  it('rewrites the template check and hands socat the credentials', () => {
    const s = socatOf(withSocatApiAuth(compose(), 'p7y:pw123')!)
    expect(s.environment).toEqual({ FRPS_API_AUTH: 'p7y:pw123' })
    expect(s.healthcheck.test).toEqual(['CMD-SHELL', 'wget -qO- http://$$FRPS_API_AUTH@127.0.0.1:7500/api/proxy/http | grep -q online'])
  })
  // frps with a password and socat without would never turn healthy: the sandbox's web addresses would be gone
  it('leaves a compose file alone whose check it does not know (an edited runtime), or that has it already', () => {
    expect(withSocatApiAuth(compose(['CMD-SHELL', 'true']), 'p7y:pw')).toBeNull()
    expect(withSocatApiAuth(withSocatApiAuth(compose(), 'p7y:pw')!, 'p7y:pw')).toBeNull()
    expect(withSocatApiAuth(': not yaml [', 'p7y:pw')).toBeNull()
  })
})

describe('migrateFrpsApiAuth', () => {
  beforeEach(() => { vi.clearAllMocks() })
  function dir(sandboxes: Record<string, { toml: string; compose: string }>): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-frps-'))
    for (const [n, f] of Object.entries(sandboxes)) {
      fs.mkdirSync(`${d}/${n}`)
      fs.writeFileSync(`${d}/${n}/frps.toml`, f.toml)
      fs.writeFileSync(`${d}/${n}/docker-compose.yml`, f.compose)
    }
    return d
  }

  it('gives old sandboxes a password and recreates frps, then socat (started only if it runs)', async () => {
    const d = dir({ 'p7y-run': { toml: OLD_TOML, compose: compose() }, 'p7y-sleep': { toml: OLD_TOML, compose: compose() } })
    vi.mocked(listManagedContainers).mockResolvedValue([sandboxMeta({ name: 'p7y-run', status: 'running' }), sandboxMeta({ name: 'p7y-sleep', status: 'exited' })])
    expect((await migrateFrpsApiAuth(d)).sort()).toEqual(['p7y-run', 'p7y-sleep'])
    const auth = frpsApiAuth(fs.readFileSync(`${d}/p7y-run/frps.toml`, 'utf8'))!
    expect(auth).toMatch(/^p7y:[0-9a-f]{32}$/)
    expect(socatOf(fs.readFileSync(`${d}/p7y-run/docker-compose.yml`, 'utf8')).environment).toEqual({ FRPS_API_AUTH: auth })
    expect(vi.mocked(composeUpService).mock.calls.filter(c => c[0] === `${d}/p7y-run/docker-compose.yml`).map(c => [c[1], c[2]]))
      .toEqual([['frps', true], ['socat', true]])
    expect(composeUpService).toHaveBeenCalledWith(`${d}/p7y-sleep/docker-compose.yml`, 'frps', false)
  })

  it('touches neither file of a sandbox whose socat check it does not know', async () => {
    const d = dir({ 'p7y-own': { toml: OLD_TOML, compose: compose(['CMD-SHELL', 'true']) } })
    vi.mocked(listManagedContainers).mockResolvedValue([sandboxMeta({ name: 'p7y-own', status: 'running' })])
    expect(await migrateFrpsApiAuth(d)).toEqual([])
    expect(fs.readFileSync(`${d}/p7y-own/frps.toml`, 'utf8')).toBe(OLD_TOML)
    expect(composeUpService).not.toHaveBeenCalled()
  })

  it('leaves sandboxes that have it alone', async () => {
    const d = dir({ 'p7y-new': { toml: frpsToml('tok', 'pw'), compose: withSocatApiAuth(compose(), 'p7y:pw')! } })
    vi.mocked(listManagedContainers).mockResolvedValue([])
    expect(await migrateFrpsApiAuth(d)).toEqual([])
    expect(composeUpService).not.toHaveBeenCalled()
  })
})
