import { accessOfHost, type HostAccess } from './hosts'
import { mayOpen } from './level'
import { APP_COOKIE, redeemTicket, readAppCookie, appCookieValue, appCookieHeader } from './sign'

/**
 * May this request open this sandbox app (p7y.access)? Traefik's forwardAuth asks for every request to a sandbox
 * whose apps are not all public, and /wake asks before waking one. Every redirect is absolute: Traefik resolves a
 * relative Location against the auth server's address. Every 200 sends Cookie and X-P7y-User: Traefik removes from
 * the request a header of authResponseHeaders that the answer leaves out.
 */
export interface DecideDeps { access: (host: string) => Promise<HostAccess | null>; env: NodeJS.ProcessEnv }
const defaults: DecideDeps = { access: h => accessOfHost(h), env: process.env }
export const LANDING = '/__p7y/auth'

const publicBase = (env: NodeJS.ProcessEnv) => (env.PUBLIC_URL ?? `https://p7y.${(env.HOST_DOMAIN ?? 'lvh.me').toLowerCase()}`).replace(/\/$/, '')
export const startUrl = (target: string, env: NodeJS.ProcessEnv = process.env) => `${publicBase(env)}/auth/app/start?rd=${encodeURIComponent(target)}`

export function withoutAppCookie(cookie: string): string {
  return cookie.split(';').map(c => c.trim()).filter(c => c && !c.startsWith(`${APP_COOKIE}=`)).join('; ')
}
/** Every __p7y_app sent: a sibling app can set a junk one for the whole domain, which the browser sends first */
const cookieValues = (cookie: string) => cookie.split(';').map(c => c.trim()).filter(c => c.startsWith(`${APP_COOKIE}=`)).map(c => c.slice(APP_COOKIE.length + 1))
/** A path on this host only: "/…", not "//…" or "/\…" (another host) */
const localPath = (p: string | null) => p && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\') ? p : '/'

export async function decide(r: { host: string; proto: string; uri: string; cookie: string }, deps: Partial<DecideDeps> = {}):
  Promise<{ status: 200 | 302 | 404; headers: Record<string, string> }> {
  const d = { ...defaults, ...deps }
  const host = r.host.replace(/:\d+$/, '').toLowerCase()
  const proto = r.proto === 'http' ? 'http' : 'https'
  const a = await d.access(host)
  if (!a) return { status: 404, headers: {} }
  if (a.access === 'public') return { status: 200, headers: { Cookie: r.cookie, 'X-P7y-User': '' } }
  const url = new URL(r.uri || '/', `${proto}://${host}`)
  if (url.pathname === LANDING) {
    const viewer = redeemTicket(url.searchParams.get('ticket') ?? '', host)
    if (viewer && mayOpen(a.access, viewer, a.owner, d.env)) {
      return { status: 302, headers: { Location: `${proto}://${host}${localPath(url.searchParams.get('rd'))}`, 'Set-Cookie': appCookieHeader(appCookieValue(host, viewer), proto === 'https'), 'Cache-Control': 'no-store' } }
    }
    return { status: 302, headers: { Location: startUrl(`${proto}://${host}/`, d.env), 'Cache-Control': 'no-store' } }
  }
  const viewer = cookieValues(r.cookie).map(v => readAppCookie(v, host)).find(v => v && mayOpen(a.access, v, a.owner, d.env)) ?? null
  if (viewer && mayOpen(a.access, viewer, a.owner, d.env)) {
    return { status: 200, headers: { Cookie: withoutAppCookie(r.cookie), 'X-P7y-User': viewer.sub } }
  }
  // No cookie, or one of a user who may not open it: to Purgatory, which signs in, or shows the refusal page
  // and issues no ticket (so no redirect loop)
  return { status: 302, headers: { Location: startUrl(`${proto}://${host}${url.pathname}${url.search}`, d.env), 'Cache-Control': 'no-store' } }
}
