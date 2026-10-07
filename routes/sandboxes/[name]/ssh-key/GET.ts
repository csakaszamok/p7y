import { requirePrincipal } from '../../../../services/principal'
import { getOwnedSandbox } from '../../../../services/access'
import { readGeneratedKey } from '../../../../services/sandboxSsh'
import { rawNameOf } from '../../../../services/naming'

export const openapi = { summary: "The sandbox's generated SSH private key (for ssh -i)", tags: ['sandboxes'], security: [{ bearerAuth: [] }] }

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const name = new URL(req.url).pathname.split('/')[2]
  try { await getOwnedSandbox(p, name) } catch { return Response.json({ error: `Sandbox not found: ${name}` }, { status: 404 }) }
  const key = readGeneratedKey(name)
  if (!key) return Response.json({ error: 'No generated SSH key' }, { status: 404 })
  return new Response(key, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${rawNameOf(name) ?? name}.key"`, 'Cache-Control': 'no-store' } })
}
