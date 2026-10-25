import { requirePrincipal } from '../../../services/principal'
import { setTheme } from '../../../services/userPrefs'

export const openapi = {
  // A UI preference, not something an agent needs
  mcp: false,
  summary: 'Choose the light or the dark theme of the web UI (for this account); system follows the device again',
  tags: ['auth'],
  security: [{ bearerAuth: [] }],
  requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['theme'], properties: { theme: { type: 'string', enum: ['light', 'dark', 'system'] } } } } } },
  responses: { 200: { description: '{ theme }' }, 400: { description: 'Not light, dark or system' } },
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const body = await req.json().catch(() => null) as { theme?: unknown } | null
  if (body?.theme !== 'light' && body?.theme !== 'dark' && body?.theme !== 'system') return Response.json({ error: 'theme must be "light", "dark" or "system"' }, { status: 400 })
  setTheme(p.sub, body.theme)
  return Response.json({ theme: body.theme })
}
