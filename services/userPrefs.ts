import fs from 'node:fs'
import { writeFileAtomic } from './atomicWrite'

/** Each account's choice of the Simple or Advanced view (by e-mail; "admin" for the local admin). */
export type View = 'simple' | 'advanced'

const defaultFile = () => process.env.USER_PREFS_FILE ?? '/app/data/user-prefs.json'

function read(file: string): Record<string, { view?: View }> {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, { view?: View }> } catch { return {} }
}

/** Until they choose: Simple for users (most only open their apps), Advanced for the admin. */
export function viewOf(sub: string, role: 'user' | 'admin', file = defaultFile()): View {
  const v = read(file)[sub.toLowerCase()]?.view
  return v === 'simple' || v === 'advanced' ? v : role === 'admin' ? 'advanced' : 'simple'
}

export function setView(sub: string, view: View, file = defaultFile()): void {
  const all = read(file)
  const key = sub.toLowerCase()
  all[key] = { ...(all[key] ?? {}), view }
  writeFileAtomic(file, JSON.stringify(all))
}
