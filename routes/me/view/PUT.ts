import { requirePrincipal } from '../../../services/principal'
import { setView } from '../../../services/userPrefs'

export const openapi = {
  // A UI preference, not something an agent needs
  mcp: false,
  summary: 'Choose the Simple or the Advanced view of the web UI (for this account)',
  tags: ['auth'],
  security: [{ bearerAuth: [] }],
  requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['view'], properties: { view: { type: 'string', enum: ['simple', 'advanced'] } } } } } },
  responses: { 200: { description: '{ view }' }, 400: { description: 'Not simple or advanced' } },
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const body = await req.json().catch(() => null) as { view?: unknown } | null
  if (body?.view !== 'simple' && body?.view !== 'advanced') return Response.json({ error: 'view must be "simple" or "advanced"' }, { status: 400 })
  setView(p.sub, body.view)
  return Response.json({ view: body.view })
}
