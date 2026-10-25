import { subAllowed } from '../allowlist'

/** Who opens an app's web address: anyone, anyone who can sign in to this Purgatorium, or its sandbox's owner. */
export type Access = 'public' | 'domain' | 'owner'
const LEVELS: Access[] = ['public', 'domain', 'owner']
const parse = (v: string | undefined): Access | null => {
  const t = (v ?? '').trim().toLowerCase()
  return (LEVELS as string[]).includes(t) ? t as Access : null
}

/** APPS_ACCESS_DEFAULT, public when unset; an unknown value is owner (closed, not open). */
export function accessDefault(env: NodeJS.ProcessEnv = process.env): Access {
  if (!env.APPS_ACCESS_DEFAULT?.trim()) return 'public'
  return parse(env.APPS_ACCESS_DEFAULT) ?? 'owner'
}

/** An app's p9m.access label; none or empty: the default; anything else: owner, and invalid (a Details warning). */
export function accessOfLabel(label: string | undefined, env: NodeJS.ProcessEnv = process.env): { access: Access; invalid: boolean } {
  if (!label?.trim()) return { access: accessDefault(env), invalid: false }
  const a = parse(label)
  return a ? { access: a, invalid: false } : { access: 'owner', invalid: true }
}

export function mostRestrictive(levels: Access[], env: NodeJS.ProcessEnv = process.env): Access {
  if (!levels.length) return accessDefault(env)
  return levels.reduce((a, b) => LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a)
}

export interface Viewer { sub: string; role: 'user' | 'admin' }

export function mayOpen(access: Access, viewer: Viewer | null, owner: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (access === 'public') return true
  if (!viewer || !subAllowed(viewer.sub, viewer.role, env)) return false
  if (viewer.role === 'admin') return true
  if (access === 'domain') return true
  return viewer.sub.toLowerCase() === owner.toLowerCase()
}
