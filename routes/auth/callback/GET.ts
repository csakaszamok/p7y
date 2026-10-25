import { finishLogin, LoginError, OIDC_FLOW_COOKIE } from '../../../services/oidc'
import { cookieHeader, createSession, getCookie, publicUrl, SESSION_COOKIE, SESSION_MAX_AGE } from '../../../services/session'
import { purgatoriumSignInRefusal } from '../../../services/allowlist'
import { rememberName } from '../../../services/hub/names'
import { nextAfterSignIn, NEXT_COOKIE } from '../../../services/appAccess/start'
import { recordSignIn } from '../../../services/userStats'

export default async (req: Request): Promise<Response> => {
  const headers = new Headers()
  headers.append('set-cookie', cookieHeader(OIDC_FLOW_COOKIE, '', 0))
  try {
    const callbackUrl = new URL(`${publicUrl()}/auth/callback${new URL(req.url).search}`)
    const { email, name } = await finishLogin(callbackUrl, getCookie(req, OIDC_FLOW_COOKIE), e => purgatoriumSignInRefusal(e))
    rememberName(email, name)
    recordSignIn(email)
    headers.append('set-cookie', cookieHeader(SESSION_COOKIE, createSession(email, 'user'), SESSION_MAX_AGE))
    // Signed in for a sandbox app (p9m.access): back to it
    const next = nextAfterSignIn(req)
    headers.set('location', next ?? '/')
    if (next) headers.append('set-cookie', cookieHeader(NEXT_COOKIE, '', 0))
  } catch (err) {
    const msg = err instanceof LoginError ? err.message : 'Sign-in failed, please try again'
    headers.set('location', `/login?error=${encodeURIComponent(msg)}`)
  }
  return new Response(null, { status: 303, headers })
}
