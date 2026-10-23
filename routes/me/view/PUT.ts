import { requirePrincipal } from '../../../services/principal'
import { setView, canSwitchView } from '../../../services/userPrefs'

export const openapi = {
  // A UI preference, not something an agent needs
  mcp: false,
  summary: 'Choose the Simple or the Advanced view of the web UI (for this account)',
  tags: ['auth'],
  security: [{ bearerAuth: [] }],
  requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['view'], properties: { view: { type: 'string', enum: ['simple', 'advanced'] } } } } } },
  responses: { 200: { description: '{ view }' }, 400: { description: 'Not simple or advanced' }, 403: { description: 'A user, without USER_VIEW_SWITCH=true' } },
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  if (!canSwitchView(p.role)) return Response.json({ error: 'users stay in the Simple view on this server (USER_VIEW_SWITCH=true lets them switch)' }, { status: 403 })
  const body = await req.json().catch(() => null) as { view?: unknown } | null
  if (body?.view !== 'simple' && body?.view !== 'advanced') return Response.json({ error: 'view must be "simple" or "advanced"' }, { status: 400 })
  setView(p.sub, body.view)
  return Response.json({ view: body.view })
}
