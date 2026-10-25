/** Purgatorium's own addresses: the UI at UI_HOST (p9m.<HOST_DOMAIN> by default), the registry, the Hub. */
import { hubHost } from './hub/config'

const domain = (env: NodeJS.ProcessEnv) => (env.HOST_DOMAIN ?? 'lvh.me').toLowerCase()

export function uiHost(env: NodeJS.ProcessEnv = process.env): string {
  return (env.UI_HOST?.trim() || `p9m.${domain(env)}`).toLowerCase()
}

/**
 * One of Purgatorium's own hosts that a sandbox of this raw name would take: its Traefik router matches
 * `<raw>-<anything>.<domain>` (see conflictingRawName), so a sandbox "console" would answer for a
 * UI_HOST of console-admin.<domain>. Null when none.
 */
export function ownHostTaken(rawName: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const d = domain(env)
  const pattern = new RegExp(`^${rawName.replace(/[^a-z0-9]/g, c => `\\${c}`)}-[a-z0-9-]+\\.${d.replace(/\./g, '\\.')}$`)
  return [uiHost(env), `registry.${d}`, hubHost(env)].find(h => pattern.test(h)) ?? null
}
