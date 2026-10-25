import fs from 'node:fs'
import { writeFileAtomic } from './atomicWrite'

/** Each account's choices (by e-mail; "admin" for the local admin): the Simple or Advanced view, the light or dark theme. */
export type View = 'simple' | 'advanced'
export type Theme = 'light' | 'dark'
type Prefs = { view?: View; theme?: Theme }

const defaultFile = () => process.env.USER_PREFS_FILE ?? '/app/data/user-prefs.json'

function read(file: string): Record<string, Prefs> {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Prefs> } catch { return {} }
}

function update(sub: string, change: (prefs: Prefs) => Prefs, file: string): void {
  const all = read(file)
  const key = sub.toLowerCase()
  all[key] = change(all[key] ?? {})
  writeFileAtomic(file, JSON.stringify(all))
}

/** USER_VIEW_SWITCH=true lets users switch; without it they stay in Simple. The admin always may. */
export function canSwitchView(role: 'user' | 'admin', env: NodeJS.ProcessEnv = process.env): boolean {
  return role === 'admin' || env.USER_VIEW_SWITCH?.trim().toLowerCase() === 'true'
}

/** Until they choose: Simple for users (most only open their apps), Advanced for the admin. A user who may not
 *  switch is in Simple; a choice saved before is kept for when USER_VIEW_SWITCH is turned on. */
export function viewOf(sub: string, role: 'user' | 'admin', file = defaultFile(), env: NodeJS.ProcessEnv = process.env): View {
  if (!canSwitchView(role, env)) return 'simple'
  const v = read(file)[sub.toLowerCase()]?.view
  return v === 'simple' || v === 'advanced' ? v : role === 'admin' ? 'advanced' : 'simple'
}

export function setView(sub: string, view: View, file = defaultFile()): void {
  update(sub, prefs => ({ ...prefs, view }), file)
}

/** The theme the account chose; null until then, and the browser follows the device's setting. */
export function themeOf(sub: string, file = defaultFile()): Theme | null {
  const t = read(file)[sub.toLowerCase()]?.theme
  return t === 'light' || t === 'dark' ? t : null
}

/** system forgets the choice. */
export function setTheme(sub: string, theme: Theme | 'system', file = defaultFile()): void {
  update(sub, ({ theme: _, ...rest }) => theme === 'system' ? rest : { ...rest, theme }, file)
}
