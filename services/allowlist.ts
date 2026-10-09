/**
 * Who may sign in with OIDC: OIDC_ALLOWED_DOMAINS (e.g. `example.com,partner.org`) and OIDC_ALLOWED_EMAILS (single
 * addresses). Without either, anyone the provider lets through — with Google, any Google account. The local admin is
 * never on a list.
 */
const list = (raw: string | undefined, strip = '') =>
  new Set((raw ?? '').split(',').map(v => v.trim().toLowerCase().replace(strip, '')).filter(Boolean))

function lists(env: NodeJS.ProcessEnv) {
  return { domains: list(env.OIDC_ALLOWED_DOMAINS, '@'), emails: list(env.OIDC_ALLOWED_EMAILS) }
}

export function signInAllowed(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const { domains, emails } = lists(env)
  if (!domains.size && !emails.size) return true
  const e = email.trim().toLowerCase()
  const at = e.lastIndexOf('@')
  // The exact domain: sub.example.com or example.com.evil.io are other domains
  return emails.has(e) || (at > 0 && domains.has(e.slice(at + 1)))
}

/** For a session or token: the admin (its session, or a token it minted for itself) is always allowed. */
export function subAllowed(sub: string, role: 'user' | 'admin', env: NodeJS.ProcessEnv = process.env): boolean {
  return role === 'admin' || sub === 'admin' || signInAllowed(sub, env)
}

/** A line for the startup log when OIDC is on and no list limits it, else null. */
export function openSignInWarning(env: NodeJS.ProcessEnv = process.env): string | null {
  const oidc = env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET
  const { domains, emails } = lists(env)
  if (!oidc || domains.size || emails.size) return null
  return `[auth] anyone with an account at ${env.OIDC_ISSUER} can sign in and create sandboxes: set OIDC_ALLOWED_DOMAINS or OIDC_ALLOWED_EMAILS to limit it`
}
