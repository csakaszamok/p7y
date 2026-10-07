import * as client from 'openid-client'
import { signValue, verifyValue, publicUrl } from './session'

export const OIDC_FLOW_COOKIE = 'p7y_oidc'
const FLOW_TTL_SEC = 600

export class LoginError extends Error {}

interface Flow { verifier: string; state: string; nonce: string; exp: number }

let configPromise: Promise<client.Configuration> | undefined

export function oidcEnabled(): boolean {
  return !!(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET)
}

export function providerName(): string {
  return process.env.OIDC_PROVIDER_NAME ?? 'Google'
}

function redirectUri(): string {
  return `${publicUrl()}/auth/callback`
}

function config(): Promise<client.Configuration> {
  if (!configPromise) {
    const issuer = new URL(process.env.OIDC_ISSUER!)
    const options = issuer.protocol === 'http:' ? { execute: [client.allowInsecureRequests] } : undefined
    configPromise = client.discovery(issuer, process.env.OIDC_CLIENT_ID!, process.env.OIDC_CLIENT_SECRET!, undefined, options)
    configPromise.catch(() => { configPromise = undefined }) // retry discovery on the next login
  }
  return configPromise
}

export async function beginLogin(): Promise<{ url: string; flow: string }> {
  const cfg = await config()
  const verifier = client.randomPKCECodeVerifier()
  const state = client.randomState()
  const nonce = client.randomNonce()
  const url = client.buildAuthorizationUrl(cfg, {
    redirect_uri: redirectUri(),
    scope: 'openid email',
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
    nonce
  })
  const flow = signValue({ verifier, state, nonce, exp: Math.floor(Date.now() / 1000) + FLOW_TTL_SEC })
  return { url: url.href, flow }
}

/** @param callbackUrl the callback as the provider sees it (PUBLIC_URL + /auth/callback + query) */
export async function finishLogin(callbackUrl: URL, flowValue: string | undefined): Promise<string> {
  const flow = verifyValue<Flow>(flowValue)
  if (!flow || flow.exp < Math.floor(Date.now() / 1000)) throw new LoginError('Sign-in expired, please try again')
  let claims: Record<string, unknown> | undefined
  try {
    const tokens = await client.authorizationCodeGrant(await config(), callbackUrl, {
      pkceCodeVerifier: flow.verifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce
    })
    claims = tokens.claims() as Record<string, unknown> | undefined
  } catch (err) {
    console.error('[oidc] code exchange failed:', err instanceof Error ? err.message : err)
    throw new LoginError('Sign-in failed, please try again')
  }
  const email = typeof claims?.email === 'string' ? claims.email.trim().toLowerCase() : ''
  if (!email) throw new LoginError('Your account has no e-mail address')
  if (!hasValidEmailShape(email)) throw new LoginError('Your account has no valid e-mail address')
  if (claims?.email_verified === false) throw new LoginError('Your e-mail address is not verified')
  return email
}

/**
 * A provider that lets a user set an arbitrary "email" claim and omits
 * email_verified could otherwise hand out a sub like "admin", colliding with
 * the local admin account. Require the bare shape of an address: exactly one
 * '@' with a non-empty local part and domain part.
 */
function hasValidEmailShape(email: string): boolean {
  const parts = email.split('@')
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0
}
