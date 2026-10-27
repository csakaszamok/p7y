/**
 * Purgatorium's own addresses (the UI, the registry, the Hub) are under HOST_DOMAIN; the sandboxes' apps, TCP and
 * Docker addresses under APPS_DOMAIN, by default the same. A separate apps domain keeps a bad app (phishing, a
 * blocklist) away from the UI's domain, and its cookies away from the UI's.
 */
export function hostDomain(env: NodeJS.ProcessEnv = process.env): string {
  return (env.HOST_DOMAIN?.trim() || 'lvh.me').toLowerCase()
}

export function appsDomain(env: NodeJS.ProcessEnv = process.env): string {
  return (env.APPS_DOMAIN?.trim() || hostDomain(env)).toLowerCase()
}
