// The device-approval flow behind /p9m:init: the agent asks for a code, the user approves it in the browser, the agent
// polls. In memory and single-use like the project link: a restart just means asking again.
import crypto from 'node:crypto'

/** How long a device code works, from when it was made */
export const DEVICE_TTL_MS = 10 * 60_000
/** Most unexpired codes at once, so nobody can fill the memory */
export const DEVICE_MAX_PENDING = 500

// No vowels and no look-alikes: a code read out loud or typed from a screen stays unambiguous
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'

type Status = 'pending' | 'approved' | 'denied'
interface Entry { userCode: string; sandbox: string | null; status: Status; expires: number; grant?: { sandbox: string; owner: string } }

const devices = new Map<string, Entry>()
const userCodes = new Map<string, string>()

function drop(deviceCode: string, e: Entry) {
  devices.delete(deviceCode)
  userCodes.delete(e.userCode)
}

function purge(now: number) {
  for (const [d, e] of devices) if (e.expires <= now) drop(d, e)
}

/** Upper case, without spaces and dashes, so `bcdf-ghjk` finds BCDF-GHJK */
export function normalizeUserCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '')
}

function newUserCode(): string {
  let c = ''
  for (let i = 0; i < 8; i++) c += USER_CODE_ALPHABET[crypto.randomInt(USER_CODE_ALPHABET.length)]
  return c
}

/** The live entry behind a user code; null when unknown or expired */
function byUserCode(userCode: string, now: number): [string, Entry] | null {
  const d = userCodes.get(normalizeUserCode(userCode))
  const e = d && devices.get(d)
  if (!d || !e) return null
  if (e.expires <= now) { drop(d, e); return null }
  return [d, e]
}

/** A new device code for the agent and the user code to show; throws at the cap */
export function startDevice(sandbox: string | null, now = Date.now()): { device_code: string; user_code: string } {
  purge(now)
  if (devices.size >= DEVICE_MAX_PENDING) throw new Error('too many pending')
  let code = newUserCode()
  while (userCodes.has(code)) code = newUserCode()
  const device_code = crypto.randomBytes(32).toString('base64url')
  devices.set(device_code, { userCode: code, sandbox, status: 'pending', expires: now + DEVICE_TTL_MS })
  userCodes.set(code, device_code)
  return { device_code, user_code: `${code.slice(0, 4)}-${code.slice(4)}` }
}

/** What the approval page shows for a user code; null when unknown or expired */
export function deviceByUserCode(userCode: string, now = Date.now()): { sandbox: string | null; status: Status } | null {
  const f = byUserCode(userCode, now)
  return f ? { sandbox: f[1].sandbox, status: f[1].status } : null
}

/** Approves a pending code; false when unknown, expired or already decided */
export function approveDevice(userCode: string, grant: { sandbox: string; owner: string }, now = Date.now()): boolean {
  const f = byUserCode(userCode, now)
  if (!f || f[1].status !== 'pending') return false
  f[1].status = 'approved'
  f[1].grant = { sandbox: grant.sandbox, owner: grant.owner }
  return true
}

/** Denies a pending code; false when unknown, expired or already decided */
export function denyDevice(userCode: string, now = Date.now()): boolean {
  const f = byUserCode(userCode, now)
  if (!f || f[1].status !== 'pending') return false
  f[1].status = 'denied'
  return true
}

/** The agent's poll; approved and denied are told once, then the entry is gone */
export function pollDevice(deviceCode: string, now = Date.now()):
  { status: 'pending' } | { status: 'denied' } | { status: 'expired' } | { status: 'approved'; sandbox: string; owner: string } {
  const e = devices.get(deviceCode)
  if (!e) return { status: 'expired' }
  if (e.expires <= now) { drop(deviceCode, e); return { status: 'expired' } }
  if (e.status === 'pending') return { status: 'pending' }
  drop(deviceCode, e)
  if (e.status === 'denied' || !e.grant) return { status: 'denied' }
  return { status: 'approved', sandbox: e.grant.sandbox, owner: e.grant.owner }
}

/** For tests */
export function _resetDevices(): void {
  devices.clear()
  userCodes.clear()
}
