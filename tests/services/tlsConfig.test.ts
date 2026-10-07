import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import yaml from 'js-yaml'
import { syncTlsConfig, tlsYaml } from '../../services/tlsConfig'

let certs: string, dynamic: string
beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ldr-tls-'))
  certs = path.join(root, 'certs'); dynamic = path.join(root, 'dynamic')
  fs.mkdirSync(certs); fs.mkdirSync(dynamic)
})
const tlsFile = () => path.join(dynamic, 'tls.yml')

describe('syncTlsConfig', () => {
  it('writes the default certificate and the HTTPS redirect when both files exist', () => {
    fs.writeFileSync(path.join(certs, 'tls.crt'), 'crt'); fs.writeFileSync(path.join(certs, 'tls.key'), 'key')
    expect(syncTlsConfig(certs, dynamic)).toBe('enabled')
    const cfg = yaml.load(fs.readFileSync(tlsFile(), 'utf8')) as any
    expect(cfg.tls.stores.default.defaultCertificate).toEqual({ certFile: '/certs/tls.crt', keyFile: '/certs/tls.key' })
    expect(cfg.http.routers['redirect-to-https']).toEqual({
      rule: 'HostRegexp(`.+`)', priority: 10000, entryPoints: ['web'], middlewares: ['redirect-to-https'], service: 'noop@internal'
    })
    expect(cfg.http.middlewares['redirect-to-https']).toEqual({ redirectScheme: { scheme: 'https', permanent: true } })
  })

  it('stays on HTTP (and removes a stale tls.yml) unless both files exist', () => {
    fs.writeFileSync(tlsFile(), tlsYaml())
    fs.writeFileSync(path.join(certs, 'tls.crt'), 'crt') // key missing
    expect(syncTlsConfig(certs, dynamic)).toBe('disabled')
    expect(fs.existsSync(tlsFile())).toBe(false)
    expect(syncTlsConfig(certs, dynamic)).toBe('disabled') // nothing to remove: no error
  })

  it('does not rewrite an unchanged file', () => {
    fs.writeFileSync(path.join(certs, 'tls.crt'), 'crt'); fs.writeFileSync(path.join(certs, 'tls.key'), 'key')
    syncTlsConfig(certs, dynamic)
    const past = new Date('2020-01-01')
    fs.utimesSync(tlsFile(), past, past)
    syncTlsConfig(certs, dynamic)
    expect(fs.statSync(tlsFile()).mtime.getTime()).toBe(past.getTime())
  })
})
