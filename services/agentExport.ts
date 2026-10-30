import { readSandboxFile } from './sandboxFs'
import { hostDomain } from './domains'
import { rawNameOf } from './naming'
import { dockerHostName } from './dockerAccess'
import { sandboxParent } from './sandboxPaths'
import { userUrl } from './userHost'

/**
 * The files of an export, in a .p9m folder for the project's folder: p9m.env, the sandbox's Docker client
 * certificates, a README with the commands, and a .gitignore of * so that git leaves the folder out on its own.
 * The certificates are read first: the returned function only fills in the token, so a token is made
 * only for an export that can be built. `docker: false`: no Docker access (p9m.env and README only).
 */
export function prepareExport(
  sandbox: string,
  opts: { usersDir?: string; readCert?: (file: string) => string; docker?: boolean } = {},
): (token: string, portainer?: { url: string; token: string } | { skipped: string }) => Array<{ path: string; data: string; mode?: number }> {
  const withDocker = opts.docker !== false
  const raw = rawNameOf(sandbox) ?? sandbox
  const url = userUrl()
  const docker = dockerHostName(sandbox)
  const registry = `registry.${hostDomain()}`
  const dir = '.p9m'
  const read = opts.readCert ?? ((f: string) => readSandboxFile(`${opts.usersDir ?? sandboxParent(sandbox)}/${sandbox}`, `certs/client/${f}`, 64 * 1024))
  const certs = withDocker ? { ca: read('ca.pem'), cert: read('cert.pem'), key: read('key.pem') } : null
  return (token, portainer) => {
  const pt = portainer && 'token' in portainer ? portainer : null
  const env = [
    '# Purgatorium sandbox access for a coding agent. A secret: keep this folder out of git.',
    `P9M_URL=${url}`,
    `P9M_TOKEN=${token}`,
    `P9M_SANDBOX=${sandbox}`,
    ...(withDocker ? [`P9M_DOCKER_HOST=tcp://${docker}:443`] : []),
    `P9M_REGISTRY=${registry}`,
    ...(pt ? [`P9M_PORTAINER_URL=${pt.url}`, `P9M_PORTAINER_TOKEN=${pt.token}`] : portainer && 'skipped' in portainer ? [`# Portainer: not included (${portainer.skipped})`] : []),
    'P9M_AGENT_GUIDE=https://csakaszamok.github.io/p9m/latest/agent-guide/index.md',
    '',
  ].join('\n')
  const dockerSection = withDocker ? `## Docker in the sandbox

Only the \`docker\` command line is needed on this machine (no Docker Desktop engine).

macOS / Linux (in your project's folder, the one this .p9m folder is in):

    docker context create p9m-${raw} --docker "host=tcp://${docker}:443,ca=$PWD/.p9m/docker/ca.pem,cert=$PWD/.p9m/docker/cert.pem,key=$PWD/.p9m/docker/key.pem"
    docker --context p9m-${raw} ps

Windows PowerShell (in your project's folder):

    docker context create p9m-${raw} --docker "host=tcp://${docker}:443,ca=$PWD\\.p9m\\docker\\ca.pem,cert=$PWD\\.p9m\\docker\\cert.pem,key=$PWD\\.p9m\\docker\\key.pem"
    docker --context p9m-${raw} ps

\`docker --context p9m-${raw} compose up -d --build\` builds and runs in the sandbox. Publish app ports on all
interfaces (\`8080:8080\`) and let the app listen on 0.0.0.0: that gives it a public address; a port published
on 127.0.0.1 stays private. A Docker connection does not wake the sandbox: wake it first
(\`curl -X POST -H "Authorization: Bearer $P9M_TOKEN" ${url}/sandboxes/${sandbox}/start\`, or open one of its apps).

` : `## Docker in the sandbox

Not in this export. In Purgatorium: the sandbox → Let your agent deploy… → Download, with Docker access (not "Without the Docker keys").

`
  const portainerSection = pt ? `## Portainer

The sandbox's Portainer API, with the token from p9m.env (no password, no sign-in):

    curl -H "X-API-Key: $P9M_PORTAINER_TOKEN" ${pt.url}/api/endpoints

The token acts as the sandbox's Portainer admin and does not expire: revoking the Purgatorium token does not
revoke it. Delete it in Portainer: My account → Access tokens.

` : ''
  const readme = `# Purgatorium access: sandbox ${raw}

This folder lets a coding agent (Claude Code, Codex…) or you use the sandbox's Docker and the Purgatorium registry.
Keep it in your project's folder, named \`.p9m\`. **It is a secret** (a token and a Docker client key): its own
\`.gitignore\` keeps it out of git; do not share it. Add \`.p9m\` to your \`.dockerignore\`, so that a build
(\`COPY . .\`) never copies it into an image.

${dockerSection}${portainerSection}## Registry

    docker login ${registry} -u ${raw}        # password: P9M_TOKEN from p9m.env
    docker --context p9m-${raw} tag myapp ${registry}/${raw}/myapp:1
    docker --context p9m-${raw} push ${registry}/${raw}/myapp:1

Anyone can pull an image without logging in, from any machine, once every version of it passed the secret scan
(one flagged version keeps the whole image private until it is deleted):

    docker pull ${registry}/${raw}/myapp:1

Never build secrets into an image (no .env files, no keys in the code): pass them when the container runs.
An image with something secret-looking in it stays private, and Purgatorium shows what it found.

## If this folder leaks

In Purgatorium: the sandbox → Access → **Rotate Docker keys…** (the Docker keys here stop working), and
Access tokens → revoke the token of this export.${pt ? ' In Portainer: My account → Access tokens → delete its token.' : ''}
`
  return [
    { path: `${dir}/.gitignore`, data: '*\n' },
    { path: `${dir}/p9m.env`, data: env, mode: 0o600 },
    ...(certs ? [
      { path: `${dir}/docker/ca.pem`, data: certs.ca },
      { path: `${dir}/docker/cert.pem`, data: certs.cert },
      { path: `${dir}/docker/key.pem`, data: certs.key, mode: 0o600 },
    ] : []),
    { path: `${dir}/README.md`, data: readme },
  ]
  }
}
