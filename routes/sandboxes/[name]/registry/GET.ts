import { requirePrincipal } from '../../../../services/principal'
import { getOwnedSandbox } from '../../../../services/access'
import { reposOf, versionsOf } from '../../../../services/registryScans'
import { rawNameOf } from '../../../../services/naming'

export const openapi = {
  summary: "The sandbox's images in the p7y registry, with secret-scan results",
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: '{ registry, public_pull, repos: [{ repo, versions }] }' }, 401: { description: 'Unauthorized' }, 404: { description: 'Sandbox not found' } },
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const name = new URL(req.url).pathname.split('/')[2]
  try { await getOwnedSandbox(p, name) } catch { return Response.json({ error: `Sandbox not found: ${name}` }, { status: 404 }) }
  const raw = rawNameOf(name) ?? name
  return Response.json({
    registry: `registry.${process.env.HOST_DOMAIN ?? 'lvh.me'}`,
    public_pull: (process.env.REGISTRY_PUBLIC_PULL ?? 'true') !== 'false',
    repos: reposOf(raw).map(repo => ({ repo, versions: versionsOf(repo) })),
  })
}
