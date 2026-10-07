import { requirePrincipal } from '../../../../services/principal'
import { getOwnedSandbox } from '../../../../services/access'
import { createToken, type TokenExpiry } from '../../../../services/tokens'
import { dockerAccessState } from '../../../../services/dockerAccess'
import { prepareExport } from '../../../../services/agentExport'
import { zip } from '../../../../services/zip'
import { rawNameOf } from '../../../../services/naming'
import { portainerAccess } from '../../../../services/portainerToken'

export const openapi = {
  summary: 'Export access for coding agents (zip: a new token, the Docker client certs, a README)',
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'application/zip' },
    401: { description: 'Unauthorized' },
    403: { description: 'Not with a token limited to one sandbox' },
    404: { description: 'Sandbox not found' },
    409: { description: 'Docker access not enabled yet' },
  },
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const name = new URL(req.url).pathname.split('/')[2]
  let sandbox
  try { sandbox = await getOwnedSandbox(p, name) } catch { return Response.json({ error: `Sandbox not found: ${name}` }, { status: 404 }) }
  // A token limited to a sandbox could otherwise mint itself new tokens and keys
  if (p.sandbox) return Response.json({ error: 'not with a token limited to one sandbox' }, { status: 403 })
  const body = await req.json().catch(() => ({})) as { name?: unknown; expires_in?: unknown; docker?: unknown; format?: unknown }
  const ready = dockerAccessState(name) === 'ready'
  const asEnv = body.format === 'env'
  // The zip with Docker keys needs Docker access; as text (no keys) it carries the Docker address only when ready
  const docker = asEnv ? ready : body.docker !== false
  if (docker && !ready) return Response.json({ error: 'enable Docker access first' }, { status: 409 })
  const expires: TokenExpiry = (['30d', '90d', 'never'] as const).includes(body.expires_in as TokenExpiry) ? body.expires_in as TokenExpiry : '90d'
  const tokenName = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : `export ${new Date().toISOString().slice(0, 10)}`
  let build
  try { build = prepareExport(name, { docker }) } catch (err) {
    return Response.json({ error: `cannot read the sandbox's Docker certificates: ${err instanceof Error ? err.message : err}` }, { status: 500 })
  }
  // Only now: a token nobody receives is never made
  const { token } = createToken(sandbox.owner, tokenName, expires, new Date(), name)
  const raw = rawNameOf(name) ?? name
  // A Portainer API token instead of its admin password (wakes the sandbox); without one the export goes on
  const portainer = await portainerAccess(sandbox, `p7y: ${tokenName}`)
  const files = build(token, portainer)
  const note: Record<string, string> = 'skipped' in portainer ? { 'X-P7y-Portainer': portainer.skipped } : {}
  if (asEnv) return new Response(files.find(f => f.path.endsWith('/p7y.env'))!.data, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...note } })
  return new Response(zip(files), {
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="p7y-${raw}.zip"`, 'Cache-Control': 'no-store', ...note },
  })
}
