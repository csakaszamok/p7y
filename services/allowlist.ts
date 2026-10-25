/**
 * Who may sign in with OIDC: OIDC_ALLOWED_DOMAINS (e.g. `example.com,partner.org`) and OIDC_ALLOWED_EMAILS (single
 * addresses). Without either, anyone the provider lets through — with Google, any Google account. The local admin is
 * never on a list.
 */
import { hubEnabled, hubUrl } from './hub/config'
const list = (raw: string | undefined, strip = '') =>
  new Set((raw ?? '').split(',').map(v => v.trim().toLowerCase().replace(strip, '')).filter(Boolean))

function lists(env: NodeJS.ProcessEnv) {
  return { domains: list(env.OIDC_ALLOWED_DOMAINS, '@'), emails: list(env.OIDC_ALLOWED_EMAILS) }
}

/** OIDC_ADMIN_EMAILS: these addresses are the admin when they sign in with OIDC in the browser (their tokens stay a user's). */
export function oidcAdmin(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return list(env.OIDC_ADMIN_EMAILS).has(email.trim().toLowerCase())
}

/** A session's role now: one signed in as an OIDC admin is a user again once taken off OIDC_ADMIN_EMAILS. */
export function sessionRole(sub: string, role: 'user' | 'admin', env: NodeJS.ProcessEnv = process.env): 'user' | 'admin' {
  return role === 'admin' && sub !== 'admin' && !oidcAdmin(sub, env) ? 'user' : role
}

/** An owner whose sandboxes no limit applies to: the local admin, and the OIDC_ADMIN_EMAILS addresses. */
export function isAdminOwner(owner: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return owner === 'admin' || oidcAdmin(owner, env)
}

export function signInAllowed(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (oidcAdmin(email, env)) return true
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

function hubLists(env: NodeJS.ProcessEnv) {
  return { domains: list(env.HUB_ALLOWED_DOMAINS, '@'), emails: list(env.HUB_ALLOWED_EMAILS) }
}

/** On the Hub: every builder, and HUB_ALLOWED_DOMAINS / HUB_ALLOWED_EMAILS (viewers). */
export function hubAllowed(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (signInAllowed(email, env)) return true
  const { domains, emails } = hubLists(env)
  const e = email.trim().toLowerCase()
  const at = e.lastIndexOf('@')
  return emails.has(e) || (at > 0 && domains.has(e.slice(at + 1)))
}

/** May use the Hub but not Purgatorium itself. */
export function viewerOnly(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return !signInAllowed(email, env) && hubAllowed(email, env)
}

/** Why Purgatorium's own sign-in refuses this e-mail, or null to let it in. */
export function purgatoriumSignInRefusal(email: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (signInAllowed(email, env)) return null
  if (hubEnabled(env) && viewerOnly(email, env)) return `You have access to the Hub only: ${hubUrl(env)}`
  return `Your account (${email}) may not sign in here. Ask the administrator.`
}
