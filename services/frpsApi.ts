import crypto from 'crypto'

/**
 * A sandbox's frps API (the proxies frpc registered; on socat's :7500) is on traefik-net. It needs a password:
 * Purgatorium reads it from frps.toml to list the apps, socat's health check gets it in FRPS_API_AUTH.
 *
 * frps's own ports are high (FRPS_PORTS): it also listens on every port the sandbox publishes (frpc's tcp proxies, on
 * their own number, for Purgatorium's TCP addresses) and on 22 and 2376 (its SSH and Docker), so an app on 8080 must
 * not meet frps's vhost there.
 */
const USER = 'p9m'

export const newFrpsApiPassword = () => crypto.randomBytes(16).toString('hex')

export const FRPS_PORTS = { bind: 65000, vhost: 65080, api: 65075 }

export function frpsToml(frpToken: string, apiPassword: string): string {
  return `bindPort = ${FRPS_PORTS.bind}\nvhostHTTPPort = ${FRPS_PORTS.vhost}\n[auth]\ntoken = "${frpToken}"\n[webServer]\naddr = "0.0.0.0"\nport = ${FRPS_PORTS.api}\nuser = "${USER}"\npassword = "${apiPassword}"\n`
}

/** `user:password` of the frps API, or null if it has none. */
export function frpsApiAuth(toml: string): string | null {
  const web = toml.split(/^\[webServer\]\s*$/m)[1]?.split(/^\[/m)[0] ?? ''
  const user = /^user\s*=\s*"([^"]*)"/m.exec(web)?.[1]
  const password = /^password\s*=\s*"([^"]*)"/m.exec(web)?.[1]
  return user && password ? `${user}:${password}` : null
}
