/** The Hub's settings: off unless HUB_ENABLED=true; its own host, hub.<HOST_DOMAIN> by default. */
const domain = (env: NodeJS.ProcessEnv) => (env.HOST_DOMAIN ?? 'lvh.me').toLowerCase()

export function hubEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HUB_ENABLED === 'true'
}

export function hubHost(env: NodeJS.ProcessEnv = process.env): string {
  return (env.HUB_HOST?.trim() || `hub.${domain(env)}`).toLowerCase()
}

/** https when Purgatorium's PUBLIC_URL is (the wildcard certificate covers both). */
export function hubUrl(env: NodeJS.ProcessEnv = process.env): string {
  const https = (env.PUBLIC_URL ?? '').startsWith('https://')
  return `${https ? 'https' : 'http'}://${hubHost(env)}`
}

export function hubTitle(env: NodeJS.ProcessEnv = process.env): string {
  return env.HUB_TITLE?.trim() || 'Hub'
}

/** The request's Host header names the Hub (port and case ignored). */
export function isHubHost(host: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!host) return false
  return host.toLowerCase().replace(/:\d+$/, '') === hubHost(env)
}
