import fs from 'fs'
import crypto from 'node:crypto'
import { writeFileAtomic } from './atomicWrite'

interface TokenRecord {
  id: string
  owner: string
  name: string
  hash: string
  created_at: string
  expires_at: string | null
  last_used_at: string | null
  /** Full sandbox name the token is limited to; missing or null = all the owner's sandboxes */
  sandbox?: string | null
  /** The token's start and end, to tell tokens apart in the list; missing on tokens made before hints */
  hint?: string | null
}
export type TokenInfo = Omit<TokenRecord, 'hash' | 'sandbox' | 'hint'> & { sandbox: string | null; hint: string | null }
export interface ResolvedToken { owner: string; sandbox: string | null }
export type TokenExpiry = '30d' | '90d' | 'never'

const EXPIRY_DAYS: Record<TokenExpiry, number | null> = { '30d': 30, '90d': 90, never: null }
const LAST_USED_RESOLUTION_MS = 60_000

function file(): string {
  return process.env.ACCESS_TOKENS_FILE ?? '/app/data/access-tokens.json'
}

/** Missing file = no tokens; a corrupt file throws so it is never silently overwritten. */
function load(): TokenRecord[] {
  const f = file()
  if (!fs.existsSync(f)) return []
  return JSON.parse(fs.readFileSync(f, 'utf8')) as TokenRecord[]
}

function save(list: TokenRecord[]): void {
  writeFileAtomic(file(), JSON.stringify(list, null, 2))
}

const sha256 = (t: string) => crypto.createHash('sha256').update(t).digest('hex')
const toInfo = ({ hash: _hash, sandbox, hint, ...rest }: TokenRecord): TokenInfo => ({ ...rest, sandbox: sandbox ?? null, hint: hint ?? null })

export function createToken(owner: string, name: string, expiresIn: TokenExpiry, now = new Date(), sandbox: string | null = null): { token: string; info: TokenInfo } {
  const list = load()
  const token = `p7y_${crypto.randomBytes(32).toString('base64url')}`
  const days = EXPIRY_DAYS[expiresIn]
  const record: TokenRecord = {
    id: crypto.randomBytes(8).toString('hex'),
    owner,
    name,
    hash: sha256(token),
    created_at: now.toISOString(),
    expires_at: days === null ? null : new Date(now.getTime() + days * 86_400_000).toISOString(),
    last_used_at: null,
    sandbox,
    hint: `${token.slice(0, 8)}…${token.slice(-4)}`
  }
  save([...list, record])
  return { token, info: toInfo(record) }
}

export function listTokens(owner?: string): TokenInfo[] {
  return load().filter(t => owner === undefined || t.owner === owner).map(toInfo)
}

export function revokeToken(id: string, owner?: string): boolean {
  const list = load()
  const i = list.findIndex(t => t.id === id && (owner === undefined || t.owner === owner))
  if (i < 0) return false
  list.splice(i, 1)
  save(list)
  return true
}

export function resolveToken(token: string, now = new Date()): ResolvedToken | null {
  // ldr_… tokens were minted before the rename (Leander) and keep working.
  if (!token.startsWith('p7y_') && !token.startsWith('ldr_')) return null
  const list = load()
  const hash = sha256(token)
  const record = list.find(t => t.hash === hash)
  if (!record) return null
  if (record.expires_at && Date.parse(record.expires_at) <= now.getTime()) return null
  const last = record.last_used_at ? Date.parse(record.last_used_at) : 0
  if (now.getTime() - last >= LAST_USED_RESOLUTION_MS) {
    record.last_used_at = now.toISOString()
    save(list)
  }
  return { owner: record.owner, sandbox: record.sandbox ?? null }
}
