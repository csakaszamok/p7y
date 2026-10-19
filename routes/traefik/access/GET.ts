import { traefikAccessConfig } from '../../../services/appAccess/traefik'

export const openapi = {
  mcp: false,
  summary: "Traefik's HTTP provider: the app access middleware of every sandbox (internal)",
  tags: ['internal'],
  responses: { 200: { description: 'Traefik dynamic configuration' }, 404: { description: 'asked through Traefik' } },
}

export default (req: Request): Response => {
  // Traefik asks directly on the internal network; a request that came through Traefik has X-Forwarded-For
  if (req.headers.get('x-forwarded-for')) return new Response('Not found', { status: 404 })
  return Response.json(traefikAccessConfig(), { headers: { 'Cache-Control': 'no-store' } })
}
