import { requirePrincipal } from '../../../services/principal'
import { revokeToken } from '../../../services/tokens'

export const openapi = { summary: 'Revoke a personal access token', tags: ['tokens'], security: [{ bearerAuth: [] }] }

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const id = new URL(req.url).pathname.split('/')[2]
  try {
    const ok = revokeToken(id, p.role === 'admin' ? undefined : p.sub)
    return ok ? Response.json({ revoked: id }) : Response.json({ error: 'Token not found' }, { status: 404 })
  } catch (err) {
    console.error('[tokens] store unreadable:', err instanceof Error ? err.message : err)
    return Response.json({ error: 'Token store unreadable' }, { status: 500 })
  }
}
