import fs from 'fs'
import { rawNameOf } from './naming'
import { dockerHostName } from './dockerAccess'
import { sandboxParent } from './sandboxPaths'

/**
 * The files of an export: p7y.env, the sandbox's Docker client certificates, a README with the commands.
 * The certificates are read first: the returned function only fills in the token, so a token is made
 * only for an export that can be built. `docker: false`: no Docker access (p7y.env and README only).
 */
export function prepareExport(
  sandbox: string,
  opts: { usersDir?: string; readCert?: (file: string) => string; docker?: boolean } = {},
): (token: string, portainer?: { url: string; token: string } | { skipped: string }) => Array<{ path: string; data: string; mode?: number }> {
  const withDocker = opts.docker !== false
  const raw = rawNameOf(sandbox) ?? sandbox
  const domain = (process.env.HOST_DOMAIN ?? 'lvh.me').toLowerCase()
  const url = (process.env.PUBLIC_URL ?? `https://p7y.${domain}`).replace(/\/$/, '')
  const docker = dockerHostName(sandbox, domain)
  const registry = `registry.${domain}`
  const dir = `p7y-${raw}`
  const read = opts.readCert ?? ((f: string) => fs.readFileSync(`${opts.usersDir ?? sandboxParent(sandbox)}/${sandbox}/certs/client/${f}`, 'utf8'))
  const certs = withDocker ? { ca: read('ca.pem'), cert: read('cert.pem'), key: read('key.pem') } : null
  return (token, portainer) => {
  const pt = portainer && 'token' in portainer ? portainer : null
  const env = [
    '# Purgatory sandbox access for a coding agent. A secret: keep this folder out of git.',
    `P7Y_URL=${url}`,
    `P7Y_TOKEN=${token}`,
    `P7Y_SANDBOX=${sandbox}`,
    ...(withDocker ? [`P7Y_DOCKER_HOST=tcp://${docker}:443`] : []),
    `P7Y_REGISTRY=${registry}`,
    ...(pt ? [`P7Y_PORTAINER_URL=${pt.url}`, `P7Y_PORTAINER_TOKEN=${pt.token}`] : portainer && 'skipped' in portainer ? [`# Portainer: not included (${portainer.skipped})`] : []),
    'P7Y_AGENT_GUIDE=https://csakaszamok.github.io/p7y/latest/agent-guide/index.md',
    '',
  ].join('\n')
  const dockerSection = withDocker ? `## Docker in the sandbox

Only the \`docker\` command line is needed on this machine (no Docker Desktop engine).

macOS / Linux (in this folder):

    docker context create p7y-${raw} --docker "host=tcp://${docker}:443,ca=$PWD/docker/ca.pem,cert=$PWD/docker/cert.pem,key=$PWD/docker/key.pem"
    docker --context p7y-${raw} ps

Windows PowerShell (in this folder):

    docker context create p7y-${raw} --docker "host=tcp://${docker}:443,ca=$PWD\\docker\\ca.pem,cert=$PWD\\docker\\cert.pem,key=$PWD\\docker\\key.pem"
    docker --context p7y-${raw} ps

\`docker --context p7y-${raw} compose up -d --build\` builds and runs in the sandbox. Publish app ports on all
interfaces (\`8080:8080\`) and let the app listen on 0.0.0.0: that gives it a public address; a port published
on 127.0.0.1 stays private. Connecting wakes the sandbox.

` : `## Docker in the sandbox

Not in this export. In Purgatory: the sandbox → Access → Export for coding agents… with Docker access.

`
  const portainerSection = pt ? `## Portainer

The sandbox's Portainer API, with the token from p7y.env (no password, no sign-in):

    curl -H "X-API-Key: $P7Y_PORTAINER_TOKEN" ${pt.url}/api/endpoints

The token acts as the sandbox's Portainer admin and does not expire: revoking the Purgatory token does not
revoke it. Delete it in Portainer: My account → Access tokens.

` : ''
  const readme = `# Purgatory access: sandbox ${raw}

This folder lets a coding agent (Claude Code, Codex…) or you use the sandbox's Docker and the Purgatory registry.
**It is a secret** (a token and a Docker client key): keep it out of git and do not share it.

${dockerSection}${portainerSection}## Registry

    docker login ${registry} -u ${raw}        # password: P7Y_TOKEN from p7y.env
    docker --context p7y-${raw} tag myapp ${registry}/${raw}/myapp:1
    docker --context p7y-${raw} push ${registry}/${raw}/myapp:1

Anyone can pull an image without logging in, from any machine, once every version of it passed the secret scan
(one flagged version keeps the whole image private until it is deleted):

    docker pull ${registry}/${raw}/myapp:1

Never build secrets into an image (no .env files, no keys in the code): pass them when the container runs.
An image with something secret-looking in it stays private, and Purgatory shows what it found.

## If this folder leaks

In Purgatory: the sandbox → Access → **Rotate Docker keys…** (the Docker keys here stop working), and
Access tokens → revoke the token of this export.${pt ? ' In Portainer: My account → Access tokens → delete its token.' : ''}
`
  return [
    { path: `${dir}/p7y.env`, data: env, mode: 0o600 },
    ...(certs ? [
      { path: `${dir}/docker/ca.pem`, data: certs.ca },
      { path: `${dir}/docker/cert.pem`, data: certs.cert },
      { path: `${dir}/docker/key.pem`, data: certs.key, mode: 0o600 },
    ] : []),
    { path: `${dir}/README.md`, data: readme },
  ]
  }
}
