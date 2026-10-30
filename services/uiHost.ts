/** Purgatorium's own addresses: the UI at UI_HOST (p9m.<HOST_DOMAIN> by default), the users' USER_HOST (sbx.<HOST_DOMAIN>), the registry, the Hub. */
import { hubHost } from './hub/config'
import { appsDomain } from './domains'

const domain = (env: NodeJS.ProcessEnv) => (env.HOST_DOMAIN ?? 'lvh.me').toLowerCase()

export function uiHost(env: NodeJS.ProcessEnv = process.env): string {
  return (env.UI_HOST?.trim() || `p9m.${domain(env)}`).toLowerCase()
}

/** USER_HOST as set, sbx.<HOST_DOMAIN> when empty; null when off ("off", or the same as UI_HOST). See userHost.ts. */
export function userHostSetting(env: NodeJS.ProcessEnv = process.env): string | null {
  const h = (env.USER_HOST?.trim() || `sbx.${domain(env)}`).toLowerCase()
  return h === 'off' || h === uiHost(env) ? null : h
}

/**
 * One of Purgatorium's own hosts that a sandbox of this raw name would take: its Traefik router matches
 * `<raw>-<anything>.<apps domain>` (see conflictingRawName), so a sandbox "console" would answer for a
 * UI_HOST of console-admin.<domain>. Null when none (always, with an APPS_DOMAIN of its own).
 */
export function ownHostTaken(rawName: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const d = appsDomain(env)
  const pattern = new RegExp(`^${rawName.replace(/[^a-z0-9]/g, c => `\\${c}`)}-[a-z0-9-]+\\.${d.replace(/\./g, '\\.')}$`)
  const user = userHostSetting(env)
  return [uiHost(env), ...(user ? [user] : []), `registry.${domain(env)}`, hubHost(env)].find(h => pattern.test(h)) ?? null
}
