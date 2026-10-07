import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { generateSshKeyPair } from '../../services/sshKeygen'
import { parsePublicKey } from '../../services/sshKeys'

function readString(buf: Buffer, off: number): [Buffer, number] {
  const n = buf.readUInt32BE(off)
  return [buf.subarray(off + 4, off + 4 + n), off + 4 + n]
}

describe('generateSshKeyPair', () => {
  it('gives a public key our own parser accepts, with the comment', () => {
    const { publicKey } = generateSshKeyPair()
    expect(parsePublicKey(publicKey)).toMatchObject({ type: 'ssh-ed25519', comment: 'p7y-generated' })
  })

  it('gives an unencrypted openssh-key-v1 private key holding the same public key', () => {
    const { publicKey, privateKey } = generateSshKeyPair('x')
    expect(privateKey.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----\n')).toBe(true)
    expect(privateKey.endsWith('-----END OPENSSH PRIVATE KEY-----\n')).toBe(true)
    const body = privateKey.split('\n').filter(l => l && !l.startsWith('-----'))
    for (const l of body) expect(l.length).toBeLessThanOrEqual(70)
    const buf = Buffer.from(body.join(''), 'base64')
    expect(buf.subarray(0, 15).toString('latin1')).toBe('openssh-key-v1\0')
    let off = 15
    let s: Buffer
    ;[s, off] = readString(buf, off); expect(s.toString()).toBe('none')
    ;[s, off] = readString(buf, off); expect(s.toString()).toBe('none')
    ;[s, off] = readString(buf, off); expect(s.length).toBe(0)
    expect(buf.readUInt32BE(off)).toBe(1); off += 4
    ;[s, off] = readString(buf, off)
    expect(s.toString('base64')).toBe(publicKey.split(' ')[1])
    const [priv] = readString(buf, off)
    expect(priv.readUInt32BE(0)).toBe(priv.readUInt32BE(4)) // checkints match
    expect(priv.length % 8).toBe(0) // padded to the block size
  })

  it('gives a different pair each time', () => {
    expect(generateSshKeyPair().publicKey).not.toBe(generateSshKeyPair().publicKey)
  })

  it('is loaded by ssh-keygen when it is available', () => {
    const probe = spawnSync('ssh-keygen', ['-?'])
    if (probe.error) return // no ssh-keygen here: the live check covers it
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-kg-'))
    const { publicKey, privateKey } = generateSshKeyPair()
    const f = path.join(dir, 'k')
    fs.writeFileSync(f, privateKey, { mode: 0o600 })
    const out = spawnSync('ssh-keygen', ['-y', '-f', f], { encoding: 'utf8' })
    fs.rmSync(dir, { recursive: true, force: true })
    if (out.status !== 0 && /permissions|UNPROTECTED/i.test(out.stderr)) return // a file system that ignores the mode
    expect(out.status, out.stderr).toBe(0)
    expect(out.stdout.trim().split(' ').slice(0, 2).join(' ')).toBe(publicKey.split(' ').slice(0, 2).join(' '))
  })
})
