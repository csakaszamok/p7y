import { requirePrincipal } from '../../../services/principal'
import { deleteUserStats } from '../../../services/userStats'

export const openapi = {
  mcp: false,
  summary: "Delete an account's stats row (admin); nothing else of the account changes",
  tags: ['users'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: '{ deleted }' }, 403: { description: 'Only the administrator' }, 404: { description: 'No such row' } },
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  if (p.role !== 'admin') return Response.json({ error: 'Only the administrator' }, { status: 403 })
  let sub: string
  try { sub = decodeURIComponent(new URL(req.url).pathname.split('/')[2] ?? '') } catch { return Response.json({ error: 'Bad name' }, { status: 400 }) }
  return deleteUserStats(sub) ? Response.json({ deleted: sub.toLowerCase() }) : Response.json({ error: 'No such row' }, { status: 404 })
}
