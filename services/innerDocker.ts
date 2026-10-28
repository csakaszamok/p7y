import Dockerode from 'dockerode'
import { sandboxParent } from './sandboxPaths'
import { readSandboxFile } from './sandboxFs'

/** The Docker daemon inside a sandbox: TLS on <name>:2376 with the sandbox's client certificate.
 * timeout 0 = none (a followed log stream may stay quiet for hours). */
export function innerDocker(name: string, usersDir = sandboxParent(name), timeout = 5000): Dockerode {
  const read = (f: string) => readSandboxFile(`${usersDir}/${name}`, `certs/client/${f}`, 64 * 1024)
  return new Dockerode({
    host: name, port: 2376, protocol: 'https',
    ca: read('ca.pem'),
    cert: read('cert.pem'),
    key: read('key.pem'),
    ...(timeout ? { timeout } : {}),
  })
}
