import { requirePrincipal } from '../../../services/principal'
import { createFeedKey } from '../../../services/hub/feedKey'
import { hubEnabled, hubUrl } from '../../../services/hub/config'

export const openapi = {
  // Not an MCP tool: it hands out a secret that ends the old link (the admin's button in Overview)
  mcp: false,
  summary: 'Create the Hub feed link (admin): a new secret key; the old link stops working',
  tags: ['hub'],
  responses: { 200: { description: '{ url }' } },
}

export default async (req: Request): Promise<Response> => {
  if (!hubEnabled()) return new Response('Not Found', { status: 404 })
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  if (p.role !== 'admin') return Response.json({ error: 'Only the administrator' }, { status: 403 })
  return Response.json({ url: `${hubUrl()}/feed.xml?key=${createFeedKey()}` })
}
