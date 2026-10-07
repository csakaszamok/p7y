import { getPrincipal } from './principal'
import { getOwnedSandbox } from './access'

export const MAX_TERMINALS_PER_USER = 5
const open = new Map<string, number>()
export function terminalOpened(sub: string): void { open.set(sub, (open.get(sub) ?? 0) + 1) }
export function terminalClosed(sub: string): void {
  const n = (open.get(sub) ?? 0) - 1
  if (n > 0) open.set(sub, n); else open.delete(sub)
}

export type GateResult = { ok: true; name: string; sub: string; release: () => void } | { ok: false; status: 401 | 403 | 404 | 429; reason: string }

/** Whether this websocket upgrade may open a shell: a browser session (no tokens), same origin, own sandbox. */
export async function checkTerminalUpgrade(url: string, headers: Record<string, string | string[] | undefined>): Promise<GateResult> {
  const m = /^\/sandboxes\/([^/]+)\/terminal$/.exec(url.split('?')[0])
  if (!m) return { ok: false, status: 404, reason: 'Not found' }
  let name: string
  try { name = decodeURIComponent(m[1]) } catch { return { ok: false, status: 404, reason: 'Not found' } }
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const cookie = one(headers.cookie)
  // A page on another site can open a websocket with the user's cookie: only our own pages may
  let originHost = ''
  try { originHost = new URL(one(headers.origin)).host } catch { /* missing or bad */ }
  if (!originHost || originHost !== one(headers.host)) {
    return cookie.includes('p7y_session=') ? { ok: false, status: 403, reason: 'Cross-site request rejected' } : { ok: false, status: 401, reason: 'Sign in first' }
  }
  // Only the session cookie counts: a bearer token never opens a terminal
  const p = getPrincipal(new Request(`http://localhost${url}`, { headers: { cookie } }))
  if (!p || p.via !== 'session') return { ok: false, status: 401, reason: 'Sign in first' }
  try { await getOwnedSandbox(p, name) } catch { return { ok: false, status: 404, reason: `Sandbox not found: ${name}` } }
  // Check and take the slot in one step (no await between): parallel upgrades cannot all slip under the limit
  if ((open.get(p.sub) ?? 0) >= MAX_TERMINALS_PER_USER) return { ok: false, status: 429, reason: `At most ${MAX_TERMINALS_PER_USER} terminals at once` }
  terminalOpened(p.sub)
  let released = false
  const sub = p.sub
  return { ok: true, name, sub, release: () => { if (!released) { released = true; terminalClosed(sub) } } }
}
