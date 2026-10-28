import { readSandboxFile, writeSandboxFile } from './sandboxFs'
import { appsDomain, hostDomain } from './domains'
import fs from 'fs'
import path from 'path'
import forge from 'node-forge'
import { generateCertBundle } from './tls'
import { rawNameOf } from './naming'
import { sandboxParent } from './sandboxPaths'


/** `<raw>-docker.<domain>`: where a Docker CLI reaches this sandbox's dockerd (TLS passed through). */
export function dockerHostName(name: string, domain = appsDomain()): string {
  return `${rawNameOf(name) ?? name}-docker.${domain}`
}

/** Whether the sandbox's dockerd certificate carries the docker name (sandboxes made before do not). */
export function dockerAccessState(name: string, usersDir = sandboxParent(name)): 'ready' | 'needs-certs' {
  try {
    const cert = forge.pki.certificateFromPem(readSandboxFile(path.join(usersDir, name), 'certs/server/cert.pem', 64 * 1024))
    const ext = cert.getExtension('subjectAltName') as { altNames?: Array<{ value?: string }> } | null
    return (ext?.altNames ?? []).some(a => a.value === dockerHostName(name)) ? 'ready' : 'needs-certs'
  } catch { return 'needs-certs' }
}

export interface DockerAccess { host: string; state: 'ready' | 'needs-certs'; hint?: string }

/**
 * What the API says about a sandbox's Docker access. While it does not run, a Docker connection does not wake it
 * (Docker Desktop reconnects to every context at once) and the client sees only EOF: the hint says what to do.
 */
export function dockerAccessInfo(name: string, status: string, usersDir = sandboxParent(name)): DockerAccess {
  const info: DockerAccess = { host: dockerHostName(name), state: dockerAccessState(name, usersDir) }
  if (status !== 'running') info.hint = `Asleep: a Docker connection does not wake it. Start it first (POST /sandboxes/${name}/start).`
  return info
}

/** The sandbox's daemon.json with the p9m registry among its insecure registries; everything else
 * (a sysbox runtime's TLS settings) stays as it is. */
function withOwnRegistry(file: string): string {
  let cfg: Record<string, unknown> = {}
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown> } catch { /* none yet */ }
  const insecure = Array.isArray(cfg['insecure-registries']) ? cfg['insecure-registries'] as string[] : []
  const own = `registry.${hostDomain()}`
  cfg['insecure-registries'] = insecure.includes(own) ? insecure : [...insecure, own]
  return JSON.stringify(cfg, null, 2)
}

/** New CA, server and client certificates (the old ones, and every export made with them, stop working),
 * the dockerd settings, then a restart so dockerd loads them. The CA key is never kept. */
export async function regenerateCerts(name: string, deps: { usersDir?: string; restart?: (name: string) => Promise<void> } = {}): Promise<void> {
  const dir = path.join(deps.usersDir ?? sandboxParent(name), name)
  const b = generateCertBundle(process.env.HOST_ADDRESS ?? '127.0.0.1', name, 2048, [dockerHostName(name)])
  // The sandbox could write its /certs before 0.12.22: never through what it may have put there
  const write = (sub: string, files: Record<string, string>) => {
    for (const [f, v] of Object.entries(files)) writeSandboxFile(dir, `certs/${sub}/${f}`, v, f === 'key.pem' ? 0o600 : 0o644)
  }
  write('server', { 'ca.pem': b.caCert, 'cert.pem': b.serverCert, 'key.pem': b.serverKey })
  write('client', { 'ca.pem': b.caCert, 'cert.pem': b.clientCert, 'key.pem': b.clientKey })
  fs.writeFileSync(path.join(dir, 'daemon.json'), withOwnRegistry(path.join(dir, 'daemon.json')))
  const restart = deps.restart ?? (async (n: string) => (await import('./sandbox')).sandboxService.restartSandbox(n))
  await restart(name)
}
