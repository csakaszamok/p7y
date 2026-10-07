import { beginLogin, oidcEnabled, OIDC_FLOW_COOKIE } from '../../../services/oidc'
import { cookieHeader } from '../../../services/session'

export default async (_req: Request): Promise<Response> => {
  if (!oidcEnabled()) return new Response(null, { status: 303, headers: { location: '/login' } })
  try {
    const { url, flow } = await beginLogin()
    return new Response(null, { status: 302, headers: { location: url, 'set-cookie': cookieHeader(OIDC_FLOW_COOKIE, flow, 600) } })
  } catch (err) {
    console.error('[oidc] discovery failed:', err instanceof Error ? err.message : err)
    return new Response(null, { status: 303, headers: { location: `/login?error=${encodeURIComponent('Sign-in provider unavailable')}` } })
  }
}
