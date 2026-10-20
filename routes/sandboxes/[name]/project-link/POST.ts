import { requirePrincipal } from '../../../../services/principal'
import { getOwnedSandbox } from '../../../../services/access'
import { dockerAccessState, dockerHostName } from '../../../../services/dockerAccess'
import { checkDockerKeys, issueProjectLink, readDockerKeys, PROJECT_LINK_TTL_MS } from '../../../../services/projectLink'
import { publicUrl } from '../../../../services/session'
import { rawNameOf } from '../../../../services/naming'

export const openapi = {
  mcp: { name: 'project_dir_link' },
  summary: "A single-use link to the project's .p7y folder, with the sandbox's Docker keys",
  description: "Answers a link that works once, for 5 minutes, and the command that unpacks it into the project (`curl -sf \"<url>\" | tar -x -C <project folder>`): the .p7y folder with .gitignore, p7y.env and docker/{ca,cert,key}.pem, the keys checked first. Run the command yourself; never copy a key. Then the docker context commands (a context keeps its own copies of the files: remove it and create it again after new keys or any TLS error, with a new link). An expired or used link answers 410: ask for a new one.",
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: '{ url, expires_in, command, context_commands }' },
    401: { description: 'Unauthorized' },
    404: { description: 'Sandbox not found' },
    409: { description: 'Docker access not enabled yet' },
    500: { description: 'The keys cannot be read or do not belong together' },
  },
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const name = new URL(req.url).pathname.split('/')[2]
  try { await getOwnedSandbox(p, name) } catch { return Response.json({ error: `Sandbox not found: ${name}` }, { status: 404 }) }
  if (dockerAccessState(name) !== 'ready') return Response.json({ error: 'enable Docker access first (the sandbox → Access → Enable; it restarts the sandbox)' }, { status: 409 })
  try {
    const k = readDockerKeys(name)
    checkDockerKeys(k.ca_cert, k.client_cert, k.client_key)
  } catch (err) {
    return Response.json({ error: `the sandbox's Docker keys: ${err instanceof Error ? err.message : err}` }, { status: 500 })
  }
  const url = `${publicUrl()}/project-dir/${issueProjectLink(name)}`
  const ctx = `p7y-${rawNameOf(name) ?? name}`
  const dir = '<project folder>/.p7y/docker'
  return Response.json({
    url,
    expires_in: PROJECT_LINK_TTL_MS / 1000,
    command: `curl -sf "${url}" | tar -x -C <project folder>`,
    context_commands: [
      `docker context rm -f ${ctx}`,
      `docker context create ${ctx} --docker "host=tcp://${dockerHostName(name)}:443,ca=${dir}/ca.pem,cert=${dir}/cert.pem,key=${dir}/key.pem"`,
    ],
  }, { headers: { 'Cache-Control': 'no-store' } })
}
