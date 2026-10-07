import { checkAdminLogin, sameOrigin } from '../../services/principal'
import { createSession, cookieHeader, SESSION_COOKIE, SESSION_MAX_AGE } from '../../services/session'

const back = (error: string) => new Response(null, { status: 303, headers: { location: `/login?error=${encodeURIComponent(error)}` } })

export default async (req: Request): Promise<Response> => {
  if (!sameOrigin(req)) return new Response('Cross-site request rejected', { status: 403 })
  const form = new URLSearchParams(await req.text())
  const ok = await checkAdminLogin(form.get('username') ?? '', form.get('password') ?? '')
  if (!ok) return back('Invalid username or password')
  return new Response(null, {
    status: 303,
    headers: { location: '/', 'set-cookie': cookieHeader(SESSION_COOKIE, createSession('admin', 'admin'), SESSION_MAX_AGE) }
  })
}
