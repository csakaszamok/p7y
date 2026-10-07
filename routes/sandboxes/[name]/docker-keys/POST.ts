import { requirePrincipal } from '../../../../services/principal'
import { getOwnedSandbox } from '../../../../services/access'
import { regenerateCerts, dockerAccessState, dockerHostName } from '../../../../services/dockerAccess'

export const openapi = {
  summary: 'New Docker access certificates (enable / rotate)',
  description: "New CA, server and client certificates for the sandbox's Docker API (they carry <raw>-docker.<domain>); earlier exports stop working. Restarts the sandbox.",
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: '{ name, docker_access }' },
    401: { description: 'Unauthorized' },
    403: { description: 'Not with a token limited to one sandbox' },
    404: { description: 'Sandbox not found' },
  },
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const name = new URL(req.url).pathname.split('/')[2]
  let sandbox
  try { sandbox = await getOwnedSandbox(p, name) } catch (err) {
    const msg = err instanceof Error ? err.message : 'error'
    return Response.json({ error: msg }, { status: msg.includes('not found') ? 404 : 500 })
  }
  // A token limited to a sandbox could otherwise hand itself new keys
  if (p.sandbox) return Response.json({ error: 'not with a token limited to one sandbox' }, { status: 403 })
  try {
    // A sandbox in deep sleep has no containers to restart: the new certificates load when it wakes
    await regenerateCerts(name, sandbox.status === 'deep_sleep' ? { restart: async () => {} } : undefined)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: `new certificates are in place, but the restart failed (${msg}): restart the sandbox` }, { status: 500 })
  }
  return Response.json({ name, docker_access: { host: dockerHostName(name), state: dockerAccessState(name) } })
}
