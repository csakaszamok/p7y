import { requirePrincipal } from '../../../../services/principal'
import { mountRoute } from '../../../../services/mountRoute'
import { removeMount } from '../../../../services/hostMounts'

export const openapi = {
  mcp: { name: 'remove_sandbox_mount' },
  summary: 'Unmount a host folder from the sandbox (admin)',
  description: 'Admin only: removes the host mount on this target (also when HOST_MOUNT_ROOTS is no longer set). The sandbox container is recreated as for adding one.',
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  parameters: [{ name: 'target', in: 'query', required: true, description: 'The mount\'s path inside the sandbox, e.g. /mnt/team', schema: { type: 'string' } }],
  responses: {
    200: { description: '{ name, mounts }: the sandbox\'s mounts after the change' },
    400: { description: 'No target given' },
    401: { description: 'Unauthorized' },
    403: { description: 'Not the administrator' },
    404: { description: 'Sandbox not found, or no mount on that target' },
    409: { description: 'Docker refused the change: nothing changed' },
  },
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const target = new URL(req.url).searchParams.get('target')
  if (!target) return Response.json({ error: 'target is required: the mount\'s path inside the sandbox' }, { status: 400 })
  return mountRoute(req, p, (name, status) => removeMount(name, status, target))
}
