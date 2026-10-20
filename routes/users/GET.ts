import { requirePrincipal } from '../../services/principal'
import { listUserStats } from '../../services/userStats'
import { listTokens } from '../../services/tokens'
import { sandboxService } from '../../services/sandbox'

export const openapi = {
  // Not an MCP tool: who signed in when is the admin's to look at, not an agent's
  mcp: false,
  summary: 'Accounts (admin): first and last seen, sign-ins, sandboxes created and owned now, last API use',
  tags: ['users'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: '{ users }' }, 401: { description: 'Unauthorized' }, 403: { description: 'Only the administrator' } },
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  if (p.role !== 'admin') return Response.json({ error: 'Only the administrator' }, { status: 403 })
  const stats = listUserStats()
  const owned = new Map<string, number>()
  for (const s of await sandboxService.listSandboxStates()) owned.set(s.owner.toLowerCase(), (owned.get(s.owner.toLowerCase()) ?? 0) + 1)
  const lastApi = new Map<string, string>()
  for (const t of listTokens()) {
    const o = t.owner.toLowerCase()
    if (t.last_used_at && (lastApi.get(o) ?? '') < t.last_used_at) lastApi.set(o, t.last_used_at)
  }
  // Owners from before the stats were kept: listed, without dates
  const known = new Set(stats.map(u => u.sub))
  const earlier = [...owned.keys()].filter(o => !known.has(o)).sort()
    .map(sub => ({ sub, first_seen: null, last_seen: null, last_sign_in: null, sign_ins: 0, sandboxes_created: 0, last_sandbox_created: null }))
  const users = [...stats, ...earlier].map(u => ({ ...u, sandboxes_now: owned.get(u.sub) ?? 0, last_api_use: lastApi.get(u.sub) ?? null }))
  return Response.json({ users }, { headers: { 'Cache-Control': 'no-store' } })
}
