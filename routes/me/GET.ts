import { requirePrincipal } from '../../services/principal'
import { quotaStatus, serverLimit, serverUsed, runningStatus } from '../../services/quota'
import { resourceDefaults } from '../../services/resources'
import { hostResources } from '../../services/docker'

export const openapi = { summary: 'Who am I', tags: ['auth'], security: [{ bearerAuth: [] }] }

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const def = resourceDefaults()
  // What the New sandbox / Resources forms offer: the default, the ceiling, and for the admin the host
  const resources = { defaults: def.limits, ceiling: def.ceiling, host: p.role === 'admin' ? await hostResources().catch(() => null) : null }
  // A user under their own quota may still be stopped by the server limit (SANDBOX_MAX_TOTAL); never the admin
  const server = serverLimit()
  const server_full = p.role !== 'admin' && server !== null && (await serverUsed()) >= server
  return Response.json({ ...p, ...(await quotaStatus(p)), ...(await runningStatus(p)), server_full, resources })
}
