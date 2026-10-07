import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-sshkeys-'))
process.env.SSH_KEYS_FILE = path.join(dir, 'ssh-keys.json')
const { parsePublicKey, listSshKeys, addSshKey, removeSshKey, sshKeysOf } = await import('../../services/sshKeys')

const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILQbLq+klAOn7bvdZ+bf7t83dWYc3AfKM/YVFsjF6tLa test@p7y'
const FP = 'SHA256:U+jnkCtA+IdjCA4MWWszk3VnBbSII8CpK7D8bzNUWXU'

describe('parsePublicKey', () => {
  it('reads type, base64, comment and the ssh-keygen fingerprint', () => {
    expect(parsePublicKey(KEY)).toEqual({
      type: 'ssh-ed25519', base64: KEY.split(' ')[1], comment: 'test@p7y', fingerprint: FP, line: KEY.split(' ').slice(0, 2).join(' '),
    })
  })

  it('accepts Windows line endings and spaces around, and keeps a comment with spaces', () => {
    expect(parsePublicKey(`  ${KEY}\r\n`)).toMatchObject({ fingerprint: FP })
    expect(parsePublicKey(KEY.replace('test@p7y', 'my laptop key'))).toMatchObject({ comment: 'my laptop key' })
  })

  it('names what is wrong', () => {
    const cases: Array<[string, string]> = [
      ['', 'key is empty'],
      ['-----BEGIN OPENSSH PRIVATE KEY-----\nb3Bl\n-----END OPENSSH PRIVATE KEY-----', 'that is a private key: paste the public one (the .pub file)'],
      [`${KEY}\n${KEY}`, 'one key per line'],
      ['ssh-dss AAAAB3NzaC1kc3M=', 'unsupported key type ssh-dss: use ssh-ed25519, ssh-rsa or ecdsa'],
      ['ssh-ed25519', 'not a public key: the base64 part is missing or broken'],
      ['ssh-ed25519 not*base64', 'not a public key: the base64 part is missing or broken'],
      [KEY.replace('ssh-ed25519', 'ssh-rsa'), 'not a public key: its data does not match its type'],
    ]
    for (const [text, error] of cases) expect(parsePublicKey(text), JSON.stringify(text)).toEqual({ error })
  })
})

describe('the per-user key store', () => {
  beforeEach(() => fs.rmSync(process.env.SSH_KEYS_FILE!, { force: true }))
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('adds, lists (own keys only) and removes', () => {
    const r = addSshKey('alice@example.com', KEY, 'laptop', new Date('2026-10-01T00:00:00Z'))
    expect(r).toMatchObject({ info: { name: 'laptop', type: 'ssh-ed25519', fingerprint: FP, created_at: '2026-10-01T00:00:00.000Z' } })
    expect(listSshKeys('alice@example.com')).toHaveLength(1)
    expect(listSshKeys('bob@example.com')).toEqual([])
    expect(sshKeysOf('alice@example.com')).toEqual([{ line: KEY.split(' ').slice(0, 2).join(' '), name: 'laptop' }])
    const id = (r as { info: { id: string } }).info.id
    expect(removeSshKey(id, 'bob@example.com')).toBe(false)
    expect(listSshKeys('alice@example.com')).toHaveLength(1)
    expect(removeSshKey(id, 'alice@example.com')).toBe(true)
    expect(listSshKeys('alice@example.com')).toEqual([])
  })

  it('names a key after its comment, refuses duplicates, long names, bad keys and a 21st key', () => {
    expect(addSshKey('a', KEY)).toMatchObject({ info: { name: 'test@p7y' } })
    expect(addSshKey('a', KEY)).toEqual({ error: 'this key is already added', status: 409 })
    expect(addSshKey('b', KEY)).toHaveProperty('info') // another user may add the same key
    expect(addSshKey('c', KEY, 'x'.repeat(81))).toEqual({ error: 'name must be at most 80 characters', status: 400 })
    expect(addSshKey('c', 'nonsense')).toEqual({ error: 'unsupported key type nonsense: use ssh-ed25519, ssh-rsa or ecdsa', status: 400 })
    const store = JSON.parse(fs.readFileSync(process.env.SSH_KEYS_FILE!, 'utf8'))
    for (let i = 0; i < 19; i++) store.push({ ...store[0], id: `f${i}`, owner: 'a', fingerprint: `SHA256:x${i}` })
    fs.writeFileSync(process.env.SSH_KEYS_FILE!, JSON.stringify(store))
    expect(addSshKey('a', KEY.replace('ILQb', 'ILQc'))).toEqual({ error: 'at most 20 keys per user', status: 409 })
  })

  // A name ends up after the key in authorized_keys: a line break would add a line (another key, options)
  it('refuses a name with line breaks or control characters, and cleans them out of a comment used as the name', () => {
    expect(addSshKey('n', KEY, 'a\nssh-ed25519 AAAA hidden')).toEqual({ error: 'name must not contain line breaks or control characters', status: 400 })
    expect(addSshKey('n', KEY, 'tab\there')).toEqual({ error: 'name must not contain line breaks or control characters', status: 400 })
    expect(addSshKey('n', KEY.replace('test@p7y', 'bell\u0007me'))).toMatchObject({ info: { name: 'bellme' } })
  })

  it('throws on a corrupt store instead of overwriting it', () => {
    fs.writeFileSync(process.env.SSH_KEYS_FILE!, '{not json')
    expect(() => addSshKey('a', KEY)).toThrow()
    expect(fs.readFileSync(process.env.SSH_KEYS_FILE!, 'utf8')).toBe('{not json')
  })
})
