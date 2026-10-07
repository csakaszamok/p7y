import { sameOrigin } from '../../services/principal'
import { cookieHeader, SESSION_COOKIE } from '../../services/session'

export default async (req: Request): Promise<Response> => {
  if (!sameOrigin(req)) return new Response('Cross-site request rejected', { status: 403 })
  return new Response(null, { status: 303, headers: { location: '/login', 'set-cookie': cookieHeader(SESSION_COOKIE, '', 0) } })
}
