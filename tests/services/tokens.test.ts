import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ldr-tokens-')), 'access-tokens.json')
process.env.ACCESS_TOKENS_FILE = FILE

import { createToken, listTokens, revokeToken, resolveToken } from '../../services/tokens'

describe('token store', () => {
  beforeEach(() => { fs.rmSync(FILE, { force: true }) })

  it('stores only a hash and resolves the token to its owner', () => {
    const now = new Date('2026-09-27T10:00:00Z')
    const { token, info } = createToken('alice@example.com', 'laptop agent', '90d', now)
    expect(token).toMatch(/^p7y_[A-Za-z0-9_-]{43}$/)
    expect(info).toMatchObject({ owner: 'alice@example.com', name: 'laptop agent', expires_at: '2026-12-26T10:00:00.000Z', last_used_at: null, sandbox: null })
    expect(fs.readFileSync(FILE, 'utf8')).not.toContain(token)
    expect(resolveToken(token, now)).toEqual({ owner: 'alice@example.com', sandbox: null })
    expect(resolveToken('p7y_nope', now)).toBeNull()
    expect(resolveToken('not-a-token', now)).toBeNull()
  })

  it('still resolves tokens minted as ldr_… before the rename', async () => {
    const crypto = await import('crypto')
    const legacy = 'ldr_legacyTokenFromLeanderDays'
    fs.writeFileSync(FILE, JSON.stringify([{ id: 'x', owner: 'bob@example.com', name: 'old', hash: crypto.createHash('sha256').update(legacy).digest('hex'), created_at: '2026-09-01T00:00:00Z', expires_at: null, last_used_at: null }]))
    expect(resolveToken(legacy, new Date('2026-09-27T10:00:00Z'))).toEqual({ owner: 'bob@example.com', sandbox: null })
  })

  it('stops resolving expired and revoked tokens', () => {
    const now = new Date('2026-09-27T10:00:00Z')
    const a = createToken('alice@example.com', 'short', '30d', now)
    const b = createToken('alice@example.com', 'forever', 'never', now)
    expect(resolveToken(a.token, new Date('2026-10-27T10:00:00Z'))).toBeNull()
    expect(resolveToken(b.token, new Date('2036-01-01T00:00:00Z'))).toEqual({ owner: 'alice@example.com', sandbox: null })
    expect(revokeToken(b.info.id, 'bob@example.com')).toBe(false) // not bob's
    expect(revokeToken(b.info.id, 'alice@example.com')).toBe(true)
    expect(resolveToken(b.token, now)).toBeNull()
  })

  it('lists per owner without hashes and records last use at most once a minute', () => {
    const t0 = new Date('2026-09-27T10:00:00Z')
    const a = createToken('alice@example.com', 'a', '90d', t0)
    createToken('bob@example.com', 'b', '90d', t0)
    expect(listTokens('alice@example.com').map(t => t.name)).toEqual(['a'])
    expect(listTokens().length).toBe(2)
    expect(JSON.stringify(listTokens())).not.toContain('hash')
    resolveToken(a.token, new Date('2026-09-27T10:00:10Z'))
    resolveToken(a.token, new Date('2026-09-27T10:00:30Z'))
    expect(listTokens('alice@example.com')[0].last_used_at).toBe('2026-09-27T10:00:10.000Z')
    resolveToken(a.token, new Date('2026-09-27T10:01:20Z'))
    expect(listTokens('alice@example.com')[0].last_used_at).toBe('2026-09-27T10:01:20.000Z')
  })

  it('binds a token to one sandbox and resolves the binding', () => {
    const now = new Date('2026-09-28T10:00:00Z')
    const { token, info } = createToken('alice@example.com', 'shop agent', '90d', now, 'p7y-shop')
    expect(info.sandbox).toBe('p7y-shop')
    expect(resolveToken(token, now)).toEqual({ owner: 'alice@example.com', sandbox: 'p7y-shop' })
    expect(listTokens('alice@example.com')[0].sandbox).toBe('p7y-shop')
  })

  it('treats a record without a sandbox field as valid for all sandboxes', async () => {
    const crypto = await import('crypto')
    const t = 'p7y_recordFromBeforeScopedTokens'
    fs.writeFileSync(FILE, JSON.stringify([{ id: 'y', owner: 'bob@example.com', name: 'old', hash: crypto.createHash('sha256').update(t).digest('hex'), created_at: '2026-09-01T00:00:00Z', expires_at: null, last_used_at: null }]))
    expect(resolveToken(t)).toEqual({ owner: 'bob@example.com', sandbox: null })
    expect(listTokens()[0].sandbox).toBeNull()
  })

  it('refuses to overwrite a corrupt store', () => {
    fs.writeFileSync(FILE, '{not json')
    expect(() => createToken('a@b.c', 'x', '90d')).toThrow()
    expect(fs.readFileSync(FILE, 'utf8')).toBe('{not json')
  })

  // The list shows the first and last few characters, to tell tokens apart; the token itself is never stored
  it('keeps a hint of the token: its start and end', () => {
    const { token, info } = createToken('alice@example.com', 'hinted', '90d')
    expect(info.hint).toBe(`${token.slice(0, 8)}…${token.slice(-4)}`)
    expect(listTokens()[0].hint).toBe(info.hint)
    expect(fs.readFileSync(FILE, 'utf8')).not.toContain(token)
  })

  it('a token made before hints has none', () => {
    fs.writeFileSync(FILE, JSON.stringify([{ id: 'old', owner: 'a@b.c', name: 'old', hash: 'x', created_at: '2026-01-01T00:00:00.000Z', expires_at: null, last_used_at: null }]))
    expect(listTokens()[0].hint).toBeNull()
  })
})
