/**
 * The users' own address, USER_HOST (e.g. sbx.<domain>): signing in, /activate and the API for /p9m:init, the
 * sandbox apps' sign-in. UI_HOST is then the admin's: a user who signs in there is sent here. Empty (or UI_HOST):
 * off, everyone uses UI_HOST as before.
 */
import { uiHost } from './uiHost'

const bare = (host: string | null | undefined) => (host ?? '').toLowerCase().replace(/:\d+$/, '')
/** PUBLIC_URL, as session.ts's publicUrl() */
const adminUrl = (env: NodeJS.ProcessEnv) => (env.PUBLIC_URL ?? `http://${uiHost(env)}`).replace(/\/+$/, '')

export function userHost(env: NodeJS.ProcessEnv = process.env): string | null {
  const h = env.USER_HOST?.trim().toLowerCase()
  return h && h !== uiHost(env) ? h : null
}

/** The request's Host header names USER_HOST (port and case ignored). */
export function isUserHost(host: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const h = userHost(env)
  return !!h && bare(host) === h
}

/** The address users are given: USER_HOST's, over PUBLIC_URL's scheme (the wildcard certificate covers both); else PUBLIC_URL. */
export function userUrl(env: NodeJS.ProcessEnv = process.env): string {
  const h = userHost(env)
  return h ? `${new URL(adminUrl(env)).protocol}//${h}` : adminUrl(env)
}

/** The address this request came to: USER_HOST's, or PUBLIC_URL (an OIDC callback must come back to the same one). */
export function requestUrl(req: Request, env: NodeJS.ProcessEnv = process.env): string {
  return isUserHost(req.headers.get('host'), env) ? userUrl(env) : adminUrl(env)
}

/** With USER_HOST on, this request is to the admin's address (UI_HOST), not the users'. */
export function onAdminHost(req: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  return !!userHost(env) && !isUserHost(req.headers.get('host'), env)
}
