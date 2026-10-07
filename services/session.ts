import crypto from 'node:crypto'

export type Role = 'user' | 'admin'
export interface Session { sub: string; role: Role; exp: number }

export const SESSION_COOKIE = 'p7y_session'
export const SESSION_MAX_AGE = 7 * 24 * 3600

let generatedSecret: string | undefined

function secret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET
  if (!generatedSecret) {
    generatedSecret = crypto.randomBytes(32).toString('hex')
    console.warn('[session] SESSION_SECRET is not set; using a temporary one (everyone is signed out on restart)')
  }
  return generatedSecret
}

function mac(data: string): string {
  return crypto.createHmac('sha256', secret()).update(data).digest('base64url')
}

export function signValue(payload: object): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${data}.${mac(data)}`
}

export function verifyValue<T>(value: string | undefined): T | null {
  if (!value) return null
  const dot = value.lastIndexOf('.')
  if (dot < 1) return null
  const data = value.slice(0, dot)
  const sig = Buffer.from(value.slice(dot + 1))
  const expected = Buffer.from(mac(data))
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}

export function createSession(sub: string, role: Role, now = Date.now()): string {
  return signValue({ sub, role, exp: Math.floor(now / 1000) + SESSION_MAX_AGE })
}

export function readSession(value: string | undefined, now = Date.now()): Session | null {
  const s = verifyValue<Session>(value)
  if (!s || typeof s.sub !== 'string' || !s.sub || (s.role !== 'user' && s.role !== 'admin') || typeof s.exp !== 'number') return null
  return s.exp > Math.floor(now / 1000) ? { sub: s.sub, role: s.role, exp: s.exp } : null
}

export function getCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

export function publicUrl(): string {
  return (process.env.PUBLIC_URL ?? `http://p7y.${process.env.HOST_DOMAIN ?? 'lvh.me'}`).replace(/\/+$/, '')
}

export function cookieHeader(name: string, value: string, maxAgeSec: number): string {
  const secure = publicUrl().startsWith('https://') ? '; Secure' : ''
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`
}
