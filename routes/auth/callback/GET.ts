import { finishLogin, LoginError, OIDC_FLOW_COOKIE } from '../../../services/oidc'
import { cookieHeader, createSession, getCookie, publicUrl, SESSION_COOKIE, SESSION_MAX_AGE } from '../../../services/session'

export default async (req: Request): Promise<Response> => {
  const headers = new Headers()
  headers.append('set-cookie', cookieHeader(OIDC_FLOW_COOKIE, '', 0))
  try {
    const callbackUrl = new URL(`${publicUrl()}/auth/callback${new URL(req.url).search}`)
    const email = await finishLogin(callbackUrl, getCookie(req, OIDC_FLOW_COOKIE))
    headers.append('set-cookie', cookieHeader(SESSION_COOKIE, createSession(email, 'user'), SESSION_MAX_AGE))
    headers.set('location', '/')
  } catch (err) {
    const msg = err instanceof LoginError ? err.message : 'Sign-in failed, please try again'
    headers.set('location', `/login?error=${encodeURIComponent(msg)}`)
  }
  return new Response(null, { status: 303, headers })
}
