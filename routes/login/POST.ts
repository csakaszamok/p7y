import { checkAdminLogin, sameOrigin } from '../../services/principal'
import { createSession, cookieHeader, SESSION_COOKIE, SESSION_MAX_AGE } from '../../services/session'
import { nextAfterSignIn, NEXT_COOKIE } from '../../services/appAccess/start'
import { recordSignIn } from '../../services/userStats'

const back = (error: string) => new Response(null, { status: 303, headers: { location: `/login?error=${encodeURIComponent(error)}` } })

export default async (req: Request): Promise<Response> => {
  if (!sameOrigin(req)) return new Response('Cross-site request rejected', { status: 403 })
  const form = new URLSearchParams(await req.text())
  const ok = await checkAdminLogin(form.get('username') ?? '', form.get('password') ?? '')
  if (!ok) return back('Invalid username or password')
  recordSignIn('admin')
  // Signed in for a sandbox app (p7y.access): back to it
  const next = nextAfterSignIn(req)
  const headers = new Headers({ location: next ?? '/' })
  headers.append('set-cookie', cookieHeader(SESSION_COOKIE, createSession('admin', 'admin'), SESSION_MAX_AGE))
  if (next) headers.append('set-cookie', cookieHeader(NEXT_COOKIE, '', 0))
  return new Response(null, { status: 303, headers })
}
