import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import forge from 'node-forge'

vi.stubEnv('HOST_DOMAIN', 'lvh.me')
const { generateCertBundle } = await import('../../services/tls')
const { dockerHostName, dockerAccessState, dockerAccessInfo, regenerateCerts } = await import('../../services/dockerAccess')

const sans = (pem: string) => (forge.pki.certificateFromPem(pem).getExtension('subjectAltName') as { altNames: Array<{ value?: string }> }).altNames.map(a => a.value)

function sandboxDir(withDockerName: boolean, daemon: Record<string, unknown> = { tlsverify: true, 'insecure-registries': ['registry-cache:5000'] }) {
  const users = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-da-'))
  const dir = path.join(users, 'p7y-shop')
  const b = generateCertBundle('127.0.0.1', 'p7y-shop', 1024, withDockerName ? ['shop-docker.lvh.me'] : [])
  for (const [sub, files] of [['server', { 'ca.pem': b.caCert, 'cert.pem': b.serverCert, 'key.pem': b.serverKey }], ['client', { 'ca.pem': b.caCert, 'cert.pem': b.clientCert, 'key.pem': b.clientKey }]] as const) {
    fs.mkdirSync(path.join(dir, 'certs', sub), { recursive: true })
    for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'certs', sub, f), v)
  }
  fs.writeFileSync(path.join(dir, 'daemon.json'), JSON.stringify(daemon))
  return users
}

describe('docker access certificates', () => {
  it('names the docker address after the raw name', () => {
    expect(dockerHostName('p7y-shop')).toBe('shop-docker.lvh.me')
  })

  it('adds extra DNS names to the server certificate', () => {
    const b = generateCertBundle('127.0.0.1', 'p7y-shop', 1024, ['shop-docker.lvh.me'])
    expect(sans(b.serverCert)).toEqual(expect.arrayContaining(['p7y-shop', 'shop-docker.lvh.me', 'host.docker.internal']))
  })

  // A Docker connection does not wake a sleeping sandbox; the client only sees EOF, so the API says what to do
  it("tells how to reach a sleeping sandbox's Docker: start it first", () => {
    const asleep = dockerAccessInfo('p7y-shop', 'exited', sandboxDir(true))
    expect(asleep).toMatchObject({ host: 'shop-docker.lvh.me', state: 'ready' })
    expect(asleep.hint).toContain('POST /sandboxes/p7y-shop/start')
    expect(dockerAccessInfo('p7y-shop', 'deep_sleep', sandboxDir(true)).hint).toBeDefined()
    expect(dockerAccessInfo('p7y-shop', 'running', sandboxDir(true))).toEqual({ host: 'shop-docker.lvh.me', state: 'ready' })
  })

  it('is ready only when the server certificate carries the name', () => {
    expect(dockerAccessState('p7y-shop', sandboxDir(true))).toBe('ready')
    expect(dockerAccessState('p7y-shop', sandboxDir(false))).toBe('needs-certs')
    expect(dockerAccessState('p7y-nope', sandboxDir(true))).toBe('needs-certs')
  })

  it('regenerates everything (a new CA), adds the registry to daemon.json keeping the rest, restarts', async () => {
    const users = sandboxDir(false)
    const before = fs.readFileSync(path.join(users, 'p7y-shop/certs/client/cert.pem'), 'utf8')
    const restart = vi.fn(async () => {})
    await regenerateCerts('p7y-shop', { usersDir: users, restart })
    expect(dockerAccessState('p7y-shop', users)).toBe('ready')
    expect(fs.readFileSync(path.join(users, 'p7y-shop/certs/client/cert.pem'), 'utf8')).not.toBe(before)
    const ca = forge.pki.certificateFromPem(fs.readFileSync(path.join(users, 'p7y-shop/certs/server/ca.pem'), 'utf8'))
    expect(ca.verify(forge.pki.certificateFromPem(fs.readFileSync(path.join(users, 'p7y-shop/certs/client/cert.pem'), 'utf8')))).toBe(true)
    const daemon = JSON.parse(fs.readFileSync(path.join(users, 'p7y-shop/daemon.json'), 'utf8'))
    expect(daemon['insecure-registries']).toEqual(['registry-cache:5000', 'registry.lvh.me'])
    expect(daemon.tlsverify).toBe(true) // a sysbox runtime's TLS settings stay
    expect(restart).toHaveBeenCalledWith('p7y-shop')
  })
})
