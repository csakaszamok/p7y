import crypto from 'crypto'
import fs from 'fs'
import yaml from 'js-yaml'
import { composeUpService } from './compose'
import { listManagedContainers } from './docker'
import { entriesIn } from './sandboxPaths'

/**
 * A sandbox's frps API (:7500, the proxies frpc registered) is reachable from other sandboxes over traefik-net, through
 * socat. It needs a password: Purgatory reads it from frps.toml to list the apps, socat's health check gets it in
 * FRPS_API_AUTH.
 */
const USER = 'p7y'
const OLD_CHECK = 'wget -qO- http://127.0.0.1:7500/api/proxy/http | grep -q online'
const CHECK = 'wget -qO- http://$$FRPS_API_AUTH@127.0.0.1:7500/api/proxy/http | grep -q online'

export const newFrpsApiPassword = () => crypto.randomBytes(16).toString('hex')

export function frpsToml(frpToken: string, apiPassword: string): string {
  return `bindPort = 7000\nvhostHTTPPort = 8080\n[auth]\ntoken = "${frpToken}"\n[webServer]\naddr = "0.0.0.0"\nport = 7500\nuser = "${USER}"\npassword = "${apiPassword}"\n`
}

/** `user:password` of the frps API, or null if it has none (a sandbox from before). */
export function frpsApiAuth(toml: string): string | null {
  const web = toml.split(/^\[webServer\]\s*$/m)[1]?.split(/^\[/m)[0] ?? ''
  const user = /^user\s*=\s*"([^"]*)"/m.exec(web)?.[1]
  const password = /^password\s*=\s*"([^"]*)"/m.exec(web)?.[1]
  return user && password ? `${user}:${password}` : null
}

/** frps.toml with a user and password for the API, or null if it has them already (or no [webServer]). */
export function withFrpsApiAuth(toml: string, apiPassword: string): string | null {
  if (frpsApiAuth(toml) || !/^\[webServer\]\s*$/m.test(toml)) return null
  return toml.replace(/^\[webServer\]\s*$/m, `[webServer]\nuser = "${USER}"\npassword = "${apiPassword}"`)
}

type Socat = { environment?: Record<string, string> | string[]; healthcheck?: { test?: unknown } }

/**
 * The compose file with socat checking the API with `auth` (user:password), or null if its check is not the one the
 * runtimes wrote (an edited runtime) or already uses it: frps with a password and socat without would never be healthy.
 */
export function withSocatApiAuth(text: string, auth: string): string | null {
  let doc: { services?: Record<string, Socat | undefined> } | null
  try { doc = yaml.load(text) as typeof doc } catch { return null }
  const socat = doc?.services?.socat
  const test = socat?.healthcheck?.test
  if (!socat || !Array.isArray(test) || test[0] !== 'CMD-SHELL' || test[1] !== OLD_CHECK) return null
  if (Array.isArray(socat.environment)) socat.environment.push(`FRPS_API_AUTH=${auth}`)
  else socat.environment = { ...socat.environment, FRPS_API_AUTH: auth }
  socat.healthcheck!.test = ['CMD-SHELL', CHECK]
  return yaml.dump(doc, { lineWidth: -1 })
}

/**
 * Sandboxes created before the frps API had a password: adds one to frps.toml and socat's check, then recreates frps
 * (it reads its config at start) and socat; started if the sandbox runs, left stopped if it sleeps. A sandbox whose
 * check is not the runtimes' is left as it is. Returns the migrated sandbox names.
 */
export async function migrateFrpsApiAuth(usersDir?: string): Promise<string[]> {
  const entries = entriesIn(usersDir)
  if (!entries.length) return []
  const status = new Map((await listManagedContainers()).map(c => [c.name, c.status]))
  const migrated: string[] = []
  for (const { name, dir } of entries) {
    const tomlPath = `${dir}/frps.toml`, composePath = `${dir}/docker-compose.yml`
    let toml: string, compose: string
    try { toml = fs.readFileSync(tomlPath, 'utf8'); compose = fs.readFileSync(composePath, 'utf8') } catch { continue }
    if (frpsApiAuth(toml)) continue
    const password = newFrpsApiPassword()
    const newToml = withFrpsApiAuth(toml, password)
    const newCompose = withSocatApiAuth(compose, `${USER}:${password}`)
    if (!newToml || !newCompose) {
      console.warn(`[frps] ${name}: its frps API stays without a password (socat's health check is not the runtime's)`)
      continue
    }
    try {
      fs.writeFileSync(tomlPath, newToml)
      fs.writeFileSync(composePath, newCompose)
      const s = status.get(name)
      if (s !== undefined) {
        await composeUpService(composePath, 'frps', s === 'running')
        await composeUpService(composePath, 'socat', s === 'running')
      }
      migrated.push(name)
      console.log(`[frps] ${name}: its frps API has a password now`)
    } catch (err) {
      fs.writeFileSync(tomlPath, toml) // retried on the next start
      fs.writeFileSync(composePath, compose)
      console.error(`[frps] ${name} failed:`, err instanceof Error ? err.message : err)
    }
  }
  return migrated
}
