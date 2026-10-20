import { projectDirFiles, readDockerKeys, takeProjectLink } from '../../../services/projectLink'
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
  const name = takeProjectLink(token)
  if (!name) return new Response('this link has expired or was used: ask for a new one (project_dir_link)\n', { status: 410, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
  let files
  try { files = projectDirFiles({ name, ...readDockerKeys(name), docker_host: dockerHostName(name) }, publicUrl()) } catch (err) {
    return new Response(`cannot give the sandbox's Docker keys: ${err instanceof Error ? err.message : err}\n`, { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
  return new Response(new Uint8Array(tarFiles(files)), { headers: { 'Content-Type': 'application/x-tar', 'Cache-Control': 'no-store' } })
}
