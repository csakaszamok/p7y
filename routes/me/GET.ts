import { publicUrl } from '../../services/session'
import { requirePrincipal } from '../../services/principal'
import { quotaStatus, serverLimit, serverUsed, runningStatus } from '../../services/quota'
import { resourceDefaults } from '../../services/resources'
import { hostResources } from '../../services/docker'
import { viewOf, canSwitchView, themeOf } from '../../services/userPrefs'
import { sandboxService } from '../../services/sandbox'

export const openapi = { mcp: { name: 'who_am_i' }, summary: 'Who am I', tags: ['auth'], security: [{ bearerAuth: [] }] }

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const def = resourceDefaults()
  // What the New sandbox / Resources forms offer: the default, the ceiling, and for the admin the host
  const resources = { defaults: def.limits, ceiling: def.ceiling, host: p.role === 'admin' ? await hostResources().catch(() => null) : null }
  // One listing for all three counts (quota, running, server places): each would otherwise list every sandbox again
  const all = await sandboxService.listSandboxStates()
  // A user under their own quota may still be stopped by the server limit (SANDBOX_MAX_TOTAL); never the admin
  const server = serverLimit()
  const used = server === null ? 0 : await serverUsed(all)
  const server_full = p.role !== 'admin' && server !== null && used >= server
  // The server's places for the topbar, for everyone: the sign-in page shows them publicly already
  const server_places = server === null ? null : { used, limit: server }
  return Response.json({ ...p, ...(await quotaStatus(p, all)), ...(await runningStatus(p, all)), server_full, server_places, resources, view: viewOf(p.sub, p.role), view_switch: canSwitchView(p.role), theme: themeOf(p.sub), url: publicUrl() })
}
