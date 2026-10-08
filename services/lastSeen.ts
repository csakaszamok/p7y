import fs from 'fs'
import { writeFileAtomic } from './atomicWrite'

/**
 * What a sandbox showed when it last ran (its apps, its TCP ports), kept in `<what>.json` in its directory:
 * asleep there is nothing to ask (frps and the inner Docker are down), and opening any of them wakes it.
 * Callers keep only a full answer: an empty one is what a sandbox gives right after a wake, before its apps are up.
 */

const written = new Map<string, string>()

export function rememberLastSeen(dir: string, what: string, value: unknown): void {
  const file = `${dir}/${what}.json`
  const json = JSON.stringify(value)
  if (written.get(file) === json) return
  try { writeFileAtomic(file, json); written.set(file, json) } catch { /* the sandbox's directory is gone */ }
}

/** The value last remembered, or null (never seen running since this was added, or unreadable). */
export function lastSeen(dir: string, what: string): unknown {
  try { return JSON.parse(fs.readFileSync(`${dir}/${what}.json`, 'utf8')) } catch { return null }
}
