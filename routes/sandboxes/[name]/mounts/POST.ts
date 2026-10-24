import { requirePrincipal } from '../../../../services/principal'
import { mountRoute } from '../../../../services/mountRoute'
import { addMount } from '../../../../services/hostMounts'

export const openapi = {
  mcp: { name: 'add_sandbox_mount' },
  summary: 'Mount a host folder into the sandbox (admin)',
  description: "Admin only, with HOST_MOUNT_ROOTS set: bind-mounts a host folder at or under one of those roots into the sandbox container (its own Docker's apps can bind it from there too). The sandbox's owner gets that folder as root. The sandbox container is recreated: a running sandbox restarts (its apps are unreachable for a few seconds), an asleep one stays asleep, one in deep sleep gets it when it wakes. A host folder that does not exist is an error from Docker, not an empty new folder.",
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['host'],
          properties: {
            host: { type: 'string', example: '/srv/shared/team', description: 'Absolute host path, at or under one of HOST_MOUNT_ROOTS' },
            target: { type: 'string', example: '/mnt/team', description: 'Where it appears in the sandbox; default /mnt/<last part of host>. Not /, a system directory (/etc, /usr, /proc…) or one of the sandbox\'s own mounts (/var/lib/docker, /opt, /root, /home, /srv…)' },
            readonly: { type: 'boolean', default: false },
          },
        },
      },
    },
  },
  responses: {
    200: { description: '{ name, mounts }: the sandbox\'s mounts after the change' },
    400: { description: 'Invalid host or target' },
    401: { description: 'Unauthorized' },
    403: { description: 'Not the administrator' },
    404: { description: 'Sandbox not found' },
    409: { description: 'HOST_MOUNT_ROOTS is not set, or Docker refused the mount (e.g. the host folder does not exist): nothing changed' },
  },
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  let body: unknown
  try { body = await req.json() } catch { return Response.json({ error: 'Body must be a JSON object' }, { status: 400 }) }
  return mountRoute(req, p, (name, status) => addMount(name, status, body))
}
