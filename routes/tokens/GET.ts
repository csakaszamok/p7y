import { requirePrincipal } from '../../services/principal'
import { listTokens } from '../../services/tokens'

export const openapi = { mcp: { name: 'list_tokens' }, summary: 'List personal access tokens (admin: all)', tags: ['tokens'], security: [{ bearerAuth: [] }] }

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  try {
    return Response.json(listTokens(p.role === 'admin' ? undefined : p.sub))
  } catch (err) {
    console.error('[tokens] store unreadable:', err instanceof Error ? err.message : err)
    return Response.json({ error: 'Token store unreadable' }, { status: 500 })
  }
}
