import fs from 'fs'
import Dockerode from 'dockerode'
import { sandboxParent } from './sandboxPaths'

/** The Docker daemon inside a sandbox: TLS on <name>:2376 with the sandbox's client certificate.
 * timeout 0 = none (a followed log stream may stay quiet for hours). */
export function innerDocker(name: string, usersDir = sandboxParent(name), timeout = 5000): Dockerode {
  const dir = `${usersDir}/${name}/certs/client`
  return new Dockerode({
    host: name, port: 2376, protocol: 'https',
    ca: fs.readFileSync(`${dir}/ca.pem`),
    cert: fs.readFileSync(`${dir}/cert.pem`),
    key: fs.readFileSync(`${dir}/key.pem`),
    ...(timeout ? { timeout } : {}),
  })
}
