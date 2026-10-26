import { sameOrigin } from '../../services/principal'
import { createSession, cookieHeader, SESSION_COOKIE, SESSION_MAX_AGE } from '../../services/session'
import { nextAfterSignIn, NEXT_COOKIE } from '../../services/appAccess/start'
import { recordSignIn } from '../../services/userStats'
import { adminSignIn, CLIENT_IP_HEADER } from '../../services/loginGuard'

const back = (error: string) => new Response(null, { status: 303, headers: { location: `/login?error=${encodeURIComponent(error)}` } })

export default async (req: Request): Promise<Response> => {
  if (!sameOrigin(req)) return new Response('Cross-site request rejected', { status: 403 })
  const form = new URLSearchParams(await req.text())
  const refused = await adminSignIn(req.headers.get(CLIENT_IP_HEADER) ?? 'unknown', form.get('username') ?? '', form.get('password') ?? '')
  if (refused) return back(refused)
  recordSignIn('admin')
  // Signed in for a sandbox app (p9m.access): back to it
  const next = nextAfterSignIn(req)
  const headers = new Headers({ location: next ?? '/' })
  headers.append('set-cookie', cookieHeader(SESSION_COOKIE, createSession('admin', 'admin'), SESSION_MAX_AGE))
  if (next) headers.append('set-cookie', cookieHeader(NEXT_COOKIE, '', 0))
  return new Response(null, { status: 303, headers })
}
