import fs from 'fs'
import path from 'path'
import crypto from 'node:crypto'

const TYPES = ['ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'sk-ssh-ed25519@openssh.com', 'sk-ecdsa-sha2-nistp256@openssh.com']
const MAX_KEYS = 20
const CONTROL = /[\x00-\x1f\x7f]/
const CONTROL_ALL = /[\x00-\x1f\x7f]/g

export interface ParsedKey { type: string; base64: string; comment: string; fingerprint: string; line: string }
interface KeyRecord { id: string; owner: string; name: string; key: string; type: string; fingerprint: string; created_at: string }
export type SshKeyInfo = Pick<KeyRecord, 'id' | 'name' | 'type' | 'fingerprint' | 'created_at'>

/** One OpenSSH public key line, checked: its base64 data must start with the type it claims. */
export function parsePublicKey(text: string): ParsedKey | { error: string } {
  const line = text.trim()
  if (!line) return { error: 'key is empty' }
  if (line.includes('-----BEGIN')) return { error: 'that is a private key: paste the public one (the .pub file)' }
  if (/[\r\n]/.test(line)) return { error: 'one key per line' }
  const [type, base64, ...comment] = line.split(/\s+/)
  if (!TYPES.includes(type)) return { error: `unsupported key type ${type}: use ssh-ed25519, ssh-rsa or ecdsa` }
  if (!base64 || !/^[A-Za-z0-9+/]+={0,3}$/.test(base64)) return { error: 'not a public key: the base64 part is missing or broken' }
  const blob = Buffer.from(base64, 'base64')
  const n = blob.length >= 4 ? blob.readUInt32BE(0) : -1
  if (n < 0 || 4 + n > blob.length || blob.subarray(4, 4 + n).toString('latin1') !== type) {
    return { error: 'not a public key: its data does not match its type' }
  }
  const fingerprint = `SHA256:${crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`
  return { type, base64, comment: comment.join(' '), fingerprint, line: `${type} ${base64}` }
}

function file(): string {
  return process.env.SSH_KEYS_FILE ?? '/app/data/ssh-keys.json'
}

/** Missing file = no keys; a corrupt file throws so it is never silently overwritten. */
function load(): KeyRecord[] {
  const f = file()
  if (!fs.existsSync(f)) return []
  return JSON.parse(fs.readFileSync(f, 'utf8')) as KeyRecord[]
}

function save(list: KeyRecord[]): void {
  const f = file()
  fs.mkdirSync(path.dirname(f), { recursive: true })
  const tmp = `${f}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2))
  fs.renameSync(tmp, f)
}

const info = (r: KeyRecord): SshKeyInfo => ({ id: r.id, name: r.name, type: r.type, fingerprint: r.fingerprint, created_at: r.created_at })

export function listSshKeys(owner: string): SshKeyInfo[] {
  return load().filter(r => r.owner === owner).map(info)
}

export function addSshKey(owner: string, key: string, name?: string, now = new Date()): { info: SshKeyInfo } | { error: string; status: 400 | 409 } {
  const parsed = parsePublicKey(key)
  if ('error' in parsed) return { error: parsed.error, status: 400 }
  // The name follows the key in authorized_keys: a line break there would add a line of its own
  if (name !== undefined && CONTROL.test(name)) return { error: 'name must not contain line breaks or control characters', status: 400 }
  const label = (name ?? '').trim() || parsed.comment.replace(CONTROL_ALL, '') || 'key'
  if (label.length > 80) return { error: 'name must be at most 80 characters', status: 400 }
  const list = load()
  const mine = list.filter(r => r.owner === owner)
  if (mine.some(r => r.fingerprint === parsed.fingerprint)) return { error: 'this key is already added', status: 409 }
  if (mine.length >= MAX_KEYS) return { error: `at most ${MAX_KEYS} keys per user`, status: 409 }
  const rec: KeyRecord = { id: crypto.randomBytes(8).toString('hex'), owner, name: label, key: parsed.line, type: parsed.type, fingerprint: parsed.fingerprint, created_at: now.toISOString() }
  save([...list, rec])
  return { info: info(rec) }
}

export function removeSshKey(id: string, owner: string): boolean {
  const list = load()
  const next = list.filter(r => !(r.id === id && r.owner === owner))
  if (next.length === list.length) return false
  save(next)
  return true
}

/** The owner's keys for an authorized_keys file. */
export function sshKeysOf(owner: string): Array<{ line: string; name: string }> {
  return load().filter(r => r.owner === owner).map(r => ({ line: r.key, name: r.name }))
}
