import { checkDockerKeys, projectDirFiles, readDockerKeys, takeProjectLink } from '../../../services/projectLink'
import { prepareExport } from '../../../services/agentExport'
import { createToken } from '../../../services/tokens'
import { dockerHostName } from '../../../services/dockerAccess'
import { publicUrl } from '../../../services/session'
import { tarFiles } from '../../../services/tar'

export const openapi = {
  // The link itself is the authorization (single use, 5 minutes); project_dir_link makes it
  mcp: false,
  summary: "A project's .p7y folder as a tar, from a single-use link",
  tags: ['sandboxes'],
  responses: {
    200: { description: 'application/x-tar' },
    410: { description: 'The link has expired or was used' },
  },
}

export default async (req: Request): Promise<Response> => {
  const token = new URL(req.url).pathname.split('/')[2] ?? ''
  const link = takeProjectLink(token)
  if (!link) return new Response('this link has expired or was used: ask for a new one (project_dir_link)\n', { status: 410, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
  const { sandbox: name, withToken } = link
  let files: Array<{ name: string; data: string; mode?: number }>
  try {
    if (withToken) {
      // Build (and check the keys) first, the token only then: one nobody receives is never made
      const k = readDockerKeys(name)
      checkDockerKeys(k.ca_cert, k.client_cert, k.client_key)
      const build = prepareExport(name, { docker: true })
      const { token: t } = createToken(withToken.owner, `Claude Code init ${new Date().toISOString().slice(0, 10)}`, '90d', new Date(), name)
      files = build(t).map(f => ({ name: f.path, data: f.data, mode: f.mode }))
    } else files = projectDirFiles({ name, ...readDockerKeys(name), docker_host: dockerHostName(name) }, publicUrl())
  } catch (err) {
    return new Response(`cannot give the sandbox's Docker keys: ${err instanceof Error ? err.message : err}\n`, { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
  return new Response(new Uint8Array(tarFiles(files)), { headers: { 'Content-Type': 'application/x-tar', 'Cache-Control': 'no-store' } })
}
