import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

/**
 * The shared secret of the registry's push notifications: generated once into the data dir, which the registry
 * reads (mounted at /auth) when it starts. No default anyone could know.
 */
export function notifySecret(file = process.env.REGISTRY_NOTIFY_SECRET_FILE ?? '/app/data/registry-notify.secret'): string {
  try {
    const s = fs.readFileSync(file, 'utf8').trim()
    if (/^[0-9a-f]{64}$/.test(s)) return s
  } catch { /* first start */ }
  const s = crypto.randomBytes(32).toString('hex')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${s}\n`, { mode: 0o644 })
  return s
}

/** Constant-time check of a presented secret. */
export function isNotifySecret(presented: string): boolean {
  const h = (v: string) => crypto.createHash('sha256').update(v).digest()
  return crypto.timingSafeEqual(h(presented), h(notifySecret()))
}
