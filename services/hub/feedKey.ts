import crypto from 'node:crypto'
import fs from 'node:fs'
import { writeFileAtomic } from '../atomicWrite'

/** The feed's secret key (readers cannot sign in): only its sha256 is kept; a new one ends the old. */
const keyFile = () => process.env.HUB_FEED_KEY_FILE ?? '/app/data/hub-feed.key'
const sha = (s: string) => crypto.createHash('sha256').update(s).digest()

export function createFeedKey(file = keyFile()): string {
  const key = `hubf_${crypto.randomBytes(24).toString('base64url')}`
  writeFileAtomic(file, sha(key).toString('hex'))
  return key
}

export function feedKeyValid(key: string | null, file = keyFile()): boolean {
  if (!key) return false
  let stored: Buffer
  try { stored = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex') } catch { return false }
  return stored.length === 32 && crypto.timingSafeEqual(stored, sha(key))
}
