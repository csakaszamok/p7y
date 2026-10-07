import { requirePrincipal } from '../../../../../../services/principal'
import { getOwnedSandbox } from '../../../../../../services/access'
import { versionsOf, forgetVersion } from '../../../../../../services/registryScans'
import { issueToken } from '../../../../../../services/registryAuth'
import { rawNameOf } from '../../../../../../services/naming'

export const openapi = {
  summary: "Delete a version of one of the sandbox's images from the p7y registry",
  description: 'The app name is URL-encoded when it has slashes (team%2Fapi for <sandbox>/team/api). An index takes its platform manifests with it; the space comes back at the weekly garbage collection.',
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: '{ deleted }' }, 404: { description: 'No such sandbox or version' }, 502: { description: 'The registry refused' } },
}

const MANIFEST_TYPES = 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  let name: string, app: string, digest: string
  try { [, , name, , app, digest] = new URL(req.url).pathname.split('/').map(decodeURIComponent) } catch { return Response.json({ error: 'no such version' }, { status: 404 }) }
  try { await getOwnedSandbox(p, name) } catch { return Response.json({ error: `Sandbox not found: ${name}` }, { status: 404 }) }
  const repo = `${rawNameOf(name) ?? name}/${app}`
  if (!versionsOf(repo).some(v => v.digest === digest)) return Response.json({ error: 'no such version' }, { status: 404 })
  const auth = { Authorization: `Bearer ${issueToken('p7y', `registry.${process.env.HOST_DOMAIN ?? 'lvh.me'}`, [{ type: 'repository', name: repo, actions: ['pull', 'push', 'delete'] }])}` }
  const base = `${process.env.REGISTRY_INTERNAL_URL ?? 'http://registry:5000'}/v2/${repo}/manifests`
  // An index's platform manifests stay pullable by digest unless they go too
  let children: string[] = []
  try {
    const r = await fetch(`${base}/${digest}`, { headers: { ...auth, Accept: MANIFEST_TYPES } })
    if (r.ok) children = (((await r.json()) as { manifests?: Array<{ digest: string }> }).manifests ?? []).map(m => m.digest)
  } catch { /* deleted below either way */ }
  for (const d of [...children, digest]) {
    const res = await fetch(`${base}/${d}`, { method: 'DELETE', headers: auth })
    if (!res.ok && res.status !== 404) return Response.json({ error: `registry: HTTP ${res.status}` }, { status: 502 })
    forgetVersion(repo, d)
  }
  return Response.json({ deleted: digest })
}
