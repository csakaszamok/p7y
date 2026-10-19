import { decide } from '../../../services/appAccess/decide'

export const openapi = {
  mcp: false,
  summary: 'Traefik forwardAuth: may this request open this sandbox app (p7y.access)',
  tags: ['auth'],
  responses: { 200: { description: 'yes' }, 302: { description: 'sign in, or the cookie' }, 404: { description: 'not a sandbox app host' } },
}

export default async (req: Request): Promise<Response> => {
  const h = req.headers
  const r = await decide({ host: h.get('x-forwarded-host') ?? h.get('host') ?? '', proto: h.get('x-forwarded-proto') ?? 'https', uri: h.get('x-forwarded-uri') ?? '/', cookie: h.get('cookie') ?? '' })
  return new Response(null, { status: r.status, headers: r.headers })
}
