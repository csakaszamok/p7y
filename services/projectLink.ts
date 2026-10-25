// A single-use link to a project's .p9m folder (its Docker keys among them), as a tar. The agent unpacks it with
// curl | tar: the keys go from Purgatorium to the disk and never pass through the model (copied by hand they get
// garbled, and in an answer they end up in its context and transcript).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { sandboxParent } from './sandboxPaths'
import { dockerHostName } from './dockerAccess'
import { publicUrl } from './session'
import { rawNameOf } from './naming'

/** How long a link works, from when it was made */
export const PROJECT_LINK_TTL_MS = 5 * 60_000

const links = new Map<string, { sandbox: string; withToken: { owner: string } | null; expires: number }>()

/** A new link's token for the sandbox's folder; withToken: the download also makes a sandbox token for the owner */
export function issueProjectLink(sandbox: string, now = Date.now(), withToken?: { owner: string }): string {
  for (const [t, l] of links) if (l.expires <= now) links.delete(t)
  const token = crypto.randomBytes(32).toString('base64url')
  links.set(token, { sandbox, withToken: withToken ?? null, expires: now + PROJECT_LINK_TTL_MS })
  return token
}

/** The link's sandbox (and whom its token is for), once; null when unknown, used or expired */
export function takeProjectLink(token: string, now = Date.now()): { sandbox: string; withToken: { owner: string } | null } | null {
  const l = links.get(token)
  if (!l) return null
  links.delete(token)
  return l.expires > now ? { sandbox: l.sandbox, withToken: l.withToken } : null
}

/** The key, the certificate and the CA belong together; throws why not */
export function checkDockerKeys(ca: string, cert: string, key: string): string {
  let k: crypto.KeyObject, c: crypto.X509Certificate, a: crypto.X509Certificate
  try { k = crypto.createPrivateKey(key) } catch { throw new Error('the private key cannot be read') }
  try { c = new crypto.X509Certificate(cert); a = new crypto.X509Certificate(ca) } catch { throw new Error('a certificate cannot be read') }
  if (!c.checkPrivateKey(k)) throw new Error('the private key does not match the certificate')
  if (!c.verify(a.publicKey)) throw new Error('the certificate is not signed by the CA')
  return c.fingerprint256
}

export interface ProjectDirSandbox { name: string; ca_cert?: string; client_cert?: string; client_key?: string; docker_host: string }

/** The .p9m folder's files; the keys are checked first */
export function projectDirFiles(s: ProjectDirSandbox, url: string): Array<{ name: string; data: string; mode?: number }> {
  if (!s.ca_cert || !s.client_cert || !s.client_key) throw new Error(`no Docker keys for ${s.name}`)
  checkDockerKeys(s.ca_cert, s.client_cert, s.client_key)
  return [
    { name: '.p9m/.gitignore', data: '*\n' },
    { name: '.p9m/p9m.env', data: `P9M_URL=${url}\nP9M_SANDBOX=${s.name}\nP9M_DOCKER_HOST=tcp://${s.docker_host}:443\n` },
    { name: '.p9m/docker/ca.pem', data: s.ca_cert },
    { name: '.p9m/docker/cert.pem', data: s.client_cert },
    { name: '.p9m/docker/key.pem', data: s.client_key, mode: 0o600 },
  ]
}

/** What project_dir_link and /device/poll answer for a link: its url, the unpack command and the docker context commands */
export function projectLinkAnswer(sandbox: string, linkToken: string): { url: string; expires_in: number; command: string; context_commands: string[] } {
  const url = `${publicUrl()}/project-dir/${linkToken}`
  const ctx = `p9m-${rawNameOf(sandbox) ?? sandbox}`
  const dir = '<project folder>/.p9m/docker'
  return {
    url,
    expires_in: PROJECT_LINK_TTL_MS / 1000,
    command: `curl -sf "${url}" | tar -x -C "<project folder>"`,
    context_commands: [
      `docker context rm -f ${ctx}`,
      `docker context create ${ctx} --docker "host=tcp://${dockerHostName(sandbox)}:443,ca=${dir}/ca.pem,cert=${dir}/cert.pem,key=${dir}/key.pem"`,
    ],
  }
}

/** The sandbox's Docker client keys, as its export reads them */
export function readDockerKeys(sandbox: string, usersDir = sandboxParent(sandbox)): { ca_cert: string; client_cert: string; client_key: string } {
  const read = (f: string) => fs.readFileSync(path.join(usersDir, sandbox, 'certs', 'client', f), 'utf8')
  return { ca_cert: read('ca.pem'), client_cert: read('cert.pem'), client_key: read('key.pem') }
}
