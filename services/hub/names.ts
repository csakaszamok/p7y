import fs from 'node:fs'
import { writeFileAtomic } from '../atomicWrite'

/** Owners' display names (the OIDC name claim), by e-mail: the Hub shows names, not addresses. */
const defaultFile = () => process.env.HUB_NAMES_FILE ?? '/app/data/hub-names.json'

function read(file: string): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string> } catch { return {} }
}

export function rememberName(email: string, name: string | null, file = defaultFile()): void {
  const n = name?.trim()
  if (!n) return
  const all = read(file)
  const key = email.trim().toLowerCase()
  if (all[key] === n) return
  all[key] = n
  try { writeFileAtomic(file, JSON.stringify(all)) } catch (err) { console.error('[hub] names:', err) }
}

export function nameOf(email: string, file = defaultFile()): string | null {
  return read(file)[email.trim().toLowerCase()] ?? null
}
