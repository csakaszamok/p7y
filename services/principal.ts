import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { readSession, getCookie, SESSION_COOKIE, publicUrl } from './session'
import { resolveToken } from './tokens'

export interface Principal {
  sub: string
  role: 'user' | 'admin'
  via: 'admin-token' | 'token' | 'session'
  /** Set only for a token limited to one sandbox (its full name) */
  sandbox?: string
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// What a token limited to one sandbox may call. Anything not listed is refused,
// so a route added later stays closed to these tokens until it is added here.
const SCOPED_ALLOWED: Array<[string, RegExp]> = [
  ['GET', /^\/sandboxes$/],
  ['GET', /^\/sandboxes\/[^/]+$/],
  ['PATCH', /^\/sandboxes\/[^/]+$/],
  ['POST', /^\/sandboxes\/[^/]+\/(start|stop|restart|deep-sleep|keep-awake)$/],
  ['GET', /^\/sandboxes\/[^/]+\/compose$/],
  ['GET', /^\/sandboxes\/[^/]+\/logs\/stream$/],
  ['GET', /^\/sandboxes\/[^/]+\/registry$/],
  ['DELETE', /^\/sandboxes\/[^/]+\/registry\/[^/]+\/[^/]+$/],
  ['GET', /^\/me$/],
  ['GET', /^\/templates$/],
  ['GET', /^\/runtimes$/],
  ['GET', /^\/sandboxes\/[^/]+\/ssh-key$/],
  ['POST', /^\/sandboxes\/[^/]+\/ssh-key$/],
]

// The router prefers a static directory under routes/sandboxes/ over [name], so such a
// segment is another endpoint (e.g. a later /sandboxes/archive), not a sandbox name.
let _staticSandboxRoutes: Set<string> | undefined
function staticSandboxRoutes(): Set<string> {
  if (!_staticSandboxRoutes) {
    try {
      _staticSandboxRoutes = new Set(fs.readdirSync(path.join(process.cwd(), 'routes', 'sandboxes'), { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('[')).map(d => d.name))
    } catch { _staticSandboxRoutes = new Set() }
  }
  return _staticSandboxRoutes
}

export function scopedTokenAllows(method: string, urlPath: string, staticRoutes = staticSandboxRoutes()): boolean {
  const p = urlPath.length > 1 ? urlPath.replace(/\/+$/, '') : urlPath
  const segment = p.split('/')[2]
  if (p.startsWith('/sandboxes/') && segment !== undefined && staticRoutes.has(segment)) return false
  return SCOPED_ALLOWED.some(([m, re]) => m === method && re.test(p))
}

export function getPrincipal(req: Request): Principal | null {
  const auth = req.headers.get('authorization') ?? ''
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim()
    const adminToken = process.env.ADMIN_TOKEN
    if (adminToken && isAdminToken(token, adminToken)) return { sub: 'admin', role: 'admin', via: 'admin-token' }
    const resolved = resolveToken(token)
    if (!resolved) return null
    return resolved.sandbox
      ? { sub: resolved.owner, role: 'user', via: 'token', sandbox: resolved.sandbox }
      : { sub: resolved.owner, role: 'user', via: 'token' }
  }
  const session = readSession(getCookie(req, SESSION_COOKIE))
  return session ? { sub: session.sub, role: session.role, via: 'session' } : null
}

/** Timing-safe admin token comparison using SHA256 hashes. */
export function isAdminToken(token: string, adminToken: string): boolean {
  const tokenHash = crypto.createHash('sha256').update(token).digest()
  const adminHash = crypto.createHash('sha256').update(adminToken).digest()
  return crypto.timingSafeEqual(tokenHash, adminHash)
}

/** Origin (or Referer) host must be this request's Host or the public URL's host. */
export function sameOrigin(req: Request): boolean {
  const source = req.headers.get('origin') ?? req.headers.get('referer')
  if (!source) return false
  let host: string
  try { host = new URL(source).host } catch { return false }
  const allowed = new Set([new URL(publicUrl()).host, req.headers.get('host') ?? ''])
  return allowed.has(host)
}

/** Identity for an API route, or the error response to return. */
export function requirePrincipal(req: Request): Principal | Response {
  const principal = getPrincipal(req)
  if (!principal) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (principal.sandbox && !scopedTokenAllows(req.method, new URL(req.url).pathname)) {
    return Response.json({ error: `This token is limited to sandbox ${principal.sandbox}` }, { status: 403 })
  }
  if (principal.via === 'session' && UNSAFE_METHODS.has(req.method) && !sameOrigin(req)) {
    return Response.json({ error: 'Cross-site request rejected' }, { status: 403 })
  }
  return principal
}

export async function checkAdminLogin(user: string, password: string): Promise<boolean> {
  const expectedUser = process.env.ADMIN_USER
  const expected = process.env.ADMIN_PASSWORD
  if (!expectedUser || !expected || user !== expectedUser) return false
  if (/^\$2[aby]\$/.test(expected)) return bcrypt.compare(password, expected)
  const a = Buffer.from(password)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
