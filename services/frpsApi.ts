import crypto from 'crypto'

/**
 * A sandbox's frps API (:7500, the proxies frpc registered) is reachable from other sandboxes over traefik-net, through
 * socat. It needs a password: Purgatorium reads it from frps.toml to list the apps, socat's health check gets it in
 * FRPS_API_AUTH.
 */
const USER = 'p9m'

export const newFrpsApiPassword = () => crypto.randomBytes(16).toString('hex')

export function frpsToml(frpToken: string, apiPassword: string): string {
  return `bindPort = 7000\nvhostHTTPPort = 8080\n[auth]\ntoken = "${frpToken}"\n[webServer]\naddr = "0.0.0.0"\nport = 7500\nuser = "${USER}"\npassword = "${apiPassword}"\n`
}

/** `user:password` of the frps API, or null if it has none. */
export function frpsApiAuth(toml: string): string | null {
  const web = toml.split(/^\[webServer\]\s*$/m)[1]?.split(/^\[/m)[0] ?? ''
  const user = /^user\s*=\s*"([^"]*)"/m.exec(web)?.[1]
  const password = /^password\s*=\s*"([^"]*)"/m.exec(web)?.[1]
  return user && password ? `${user}:${password}` : null
}
