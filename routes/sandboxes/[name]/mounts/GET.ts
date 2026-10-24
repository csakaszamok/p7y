import { requirePrincipal } from '../../../../services/principal'
import { getOwnedSandbox } from '../../../../services/access'
import { mountsOf, hostMountRoots } from '../../../../services/hostMounts'

export const openapi = {
  mcp: { name: 'list_sandbox_mounts' },
  summary: 'Host folders mounted into the sandbox',
  description: 'The host folders the administrator mounted into the sandbox (host path, target inside the sandbox, readonly). enabled: whether HOST_MOUNT_ROOTS is set on this server; the admin also gets roots, the folders that may be mounted.',
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: '{ name, enabled, roots (admin only), mounts: [{ host, target, readonly }] }' },
    401: { description: 'Unauthorized' },
    404: { description: 'Sandbox not found' },
  },
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const name = new URL(req.url).pathname.split('/')[2]
  try {
    await getOwnedSandbox(p, name)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'error'
    return Response.json({ error: msg }, { status: msg.includes('not found') ? 404 : 500 })
  }
  const roots = hostMountRoots()
  return Response.json({ name, enabled: roots.length > 0, ...(p.role === 'admin' ? { roots } : {}), mounts: mountsOf(name) })
}
