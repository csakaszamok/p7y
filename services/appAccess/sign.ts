import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { writeFileAtomic } from '../atomicWrite'
import type { Viewer } from './level'

/**
 * The app access ticket (Purgatorium's host → the app's host, once) and cookie (on the app's host only). Signed with
 * their own secret, never the session's: an app could see its cookie, and must not learn anything that works in
 * Purgatorium.
 */
export const APP_COOKIE = '__p9m_app'
const TICKET_MS = 60_000
const COOKIE_S = 8 * 3600

let key: string | null = null
const used = new Map<string, number>()
const keyFile = () => process.env.APP_ACCESS_KEY_FILE ?? '/app/data/app-access.key'

function secret(): string {
  if (process.env.APP_ACCESS_SECRET) return process.env.APP_ACCESS_SECRET
  if (key) return key
  try { key = fs.readFileSync(keyFile(), 'utf8').trim() } catch { key = '' }
  if (!key) {
    key = crypto.randomBytes(32).toString('hex')
    try { fs.mkdirSync(path.dirname(keyFile()), { recursive: true }); writeFileAtomic(keyFile(), key) } catch { /* in memory only */ }
  }
  return key
}

const mac = (data: string) => crypto.createHmac('sha256', secret()).update(data).digest('base64url')
function sign(payload: object): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${data}.${mac(data)}`
}
function verify<T>(value: string | undefined): T | null {
  if (!value) return null
  const dot = value.lastIndexOf('.')
  if (dot < 1) return null
  const data = value.slice(0, dot)
  const a = Buffer.from(value.slice(dot + 1)), b = Buffer.from(mac(data))
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try { return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as T } catch { return null }
}

interface Signed { k: 't' | 'c'; h: string; s: string; r: 'user' | 'admin'; e: number; n?: string }
const viewerOf = (p: Signed): Viewer => ({ sub: p.s, role: p.r })

export function issueTicket(host: string, viewer: Viewer, now = Date.now()): string {
  return sign({ k: 't', h: host.toLowerCase(), s: viewer.sub, r: viewer.role, e: now + TICKET_MS, n: crypto.randomBytes(12).toString('base64url') })
}

export function redeemTicket(ticket: string, host: string, now = Date.now()): Viewer | null {
  const p = verify<Signed>(ticket)
  if (!p || p.k !== 't' || p.h !== host.toLowerCase() || p.e < now || !p.n) return null
  for (const [n, e] of used) if (e < now) used.delete(n)
  if (used.has(p.n)) return null
  used.set(p.n, p.e)
  return viewerOf(p)
}

export function appCookieValue(host: string, viewer: Viewer, now = Date.now()): string {
  return sign({ k: 'c', h: host.toLowerCase(), s: viewer.sub, r: viewer.role, e: now + COOKIE_S * 1000 })
}

export function readAppCookie(value: string | undefined, host: string, now = Date.now()): Viewer | null {
  const p = verify<Signed>(value)
  return p && p.k === 'c' && p.h === host.toLowerCase() && p.e >= now ? viewerOf(p) : null
}

/** Host-only (no Domain): the browser sends it to this app's address alone. */
export function appCookieHeader(value: string, secure: boolean): string {
  return `${APP_COOKIE}=${value}; Path=/; Max-Age=${COOKIE_S}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
}

/** Where to go back to after signing in (p9m_next), signed: a sandbox app on a sibling address can set a cookie
 * for the whole domain, but not sign one. 10 minutes. */
export function signNext(path: string, now = Date.now()): string { return sign({ k: 'n', p: path, e: now + 600_000 }) }
export function readNext(value: string | undefined, now = Date.now()): string | null {
  const v = verify<{ k: string; p: string; e: number }>(value)
  return v && v.k === 'n' && typeof v.p === 'string' && v.e >= now ? v.p : null
}

export function _resetSign(): void { key = null; used.clear() }
