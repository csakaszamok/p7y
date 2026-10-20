import fs from 'node:fs'
import { writeFileAtomic } from './atomicWrite'

/**
 * Per account (by e-mail; "admin" for the local admin): when first and last seen, sign-ins, sandboxes created.
 * Kept until the admin deletes a row (Overview → Users). Only the admin sees it.
 */
export interface UserStats {
  sub: string
  first_seen: string
  last_seen: string
  last_sign_in: string | null
  sign_ins: number
  sandboxes_created: number
  last_sandbox_created: string | null
}

const defaultFile = () => process.env.USER_STATS_FILE ?? '/app/data/user-stats.json'
// A page load moves last_seen at most this often: no file write on every request
const SEEN_EVERY_MS = 10 * 60_000
const seenAt = new Map<string, number>()

type Stored = Record<string, Omit<UserStats, 'sub'>>

function read(file: string): Stored {
  try { return readStrict(file) } catch { return {} }
}

// Before a write: only a missing file is empty; an unreadable one is left alone rather than overwritten
function readStrict(file: string): Stored {
  let text: string
  try { text = fs.readFileSync(file, 'utf8') } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
  return JSON.parse(text) as Stored
}

// Never in the way of a sign-in or a create: a failed write is logged and skipped
function update(sub: string, now: Date, file: string, change: (u: Omit<UserStats, 'sub'>) => void): void {
  try { write(sub, now, file, change) } catch (err) { console.warn(`[users] cannot record ${sub}: ${err instanceof Error ? err.message : err}`) }
}

function write(sub: string, now: Date, file: string, change: (u: Omit<UserStats, 'sub'>) => void): void {
  const all = readStrict(file)
  const key = sub.toLowerCase()
  const at = now.toISOString()
  const u = all[key] ?? { first_seen: at, last_seen: at, last_sign_in: null, sign_ins: 0, sandboxes_created: 0, last_sandbox_created: null }
  u.last_seen = at
  change(u)
  all[key] = u
  writeFileAtomic(file, JSON.stringify(all))
  seenAt.set(key, now.getTime())
}

export function recordSignIn(sub: string, now = new Date(), file = defaultFile()): void {
  update(sub, now, file, u => { u.sign_ins++; u.last_sign_in = now.toISOString() })
}

export function recordSandboxCreated(sub: string, now = new Date(), file = defaultFile()): void {
  update(sub, now, file, u => { u.sandboxes_created++; u.last_sandbox_created = now.toISOString() })
}

/** A signed-in page load. */
export function recordSeen(sub: string, now = new Date(), file = defaultFile()): void {
  const last = seenAt.get(sub.toLowerCase())
  if (last !== undefined && now.getTime() - last < SEEN_EVERY_MS) return
  update(sub, now, file, () => {})
}

/** Newest last_seen first. */
export function listUserStats(file = defaultFile()): UserStats[] {
  return Object.entries(read(file)).map(([sub, u]) => ({ sub, ...u })).sort((a, b) => b.last_seen.localeCompare(a.last_seen))
}

export function deleteUserStats(sub: string, file = defaultFile()): boolean {
  const all = readStrict(file)
  const key = sub.toLowerCase()
  if (!(key in all)) return false
  delete all[key]
  writeFileAtomic(file, JSON.stringify(all))
  seenAt.delete(key)
  return true
}

/** Tests: forget the in-memory throttle. */
export function _resetSeen(): void { seenAt.clear() }
