import { sameOrigin } from '../../../services/principal'
import { getCookie, idleLeft, idleTimeout, readSession, SESSION_COOKIE, touchedSessionCookie } from '../../../services/session'

export const openapi = {
  // The web UI's own sign-out timer, not something an agent needs
  mcp: false,
  summary: 'The browser session\'s user did something (a click, a key): its idle time starts again',
  tags: ['auth'],
  responses: { 200: { description: '{ idle_timeout, idle_left } in seconds, and the renewed session cookie' }, 401: { description: 'Not signed in (or signed out for doing nothing)' }, 403: { description: 'Cross-site request' } },
}

export default (req: Request): Response => {
  if (!sameOrigin(req)) return Response.json({ error: 'Cross-site request rejected' }, { status: 403 })
  const value = getCookie(req, SESSION_COOKIE)
  const cookie = touchedSessionCookie(value)
  if (!cookie) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const s = readSession(cookie.split(';')[0].slice(SESSION_COOKIE.length + 1))!
  return Response.json({ idle_timeout: idleTimeout(), idle_left: idleLeft(s) }, { headers: { 'set-cookie': cookie } })
}
