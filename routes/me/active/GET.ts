import { getCookie, idleLeft, idleTimeout, readSession, SESSION_COOKIE } from '../../../services/session'

export const openapi = {
  // The web UI's own sign-out timer, not something an agent needs
  mcp: false,
  summary: "How long the browser session has left before it ends for doing nothing (does not count as doing something)",
  tags: ['auth'],
  responses: { 200: { description: '{ idle_timeout, idle_left } in seconds; null: no idle limit' }, 401: { description: 'Not signed in (or signed out for doing nothing)' } },
}

export default (req: Request): Response => {
  const s = readSession(getCookie(req, SESSION_COOKIE))
  if (!s) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  return Response.json({ idle_timeout: idleTimeout(), idle_left: idleLeft(s) })
}
