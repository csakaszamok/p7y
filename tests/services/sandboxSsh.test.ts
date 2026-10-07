import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-sandboxssh-'))
process.env.SSH_KEYS_FILE = path.join(root, 'ssh-keys.json')
const users = path.join(root, 'users')
const { addSshKey } = await import('../../services/sshKeys')
const { sandboxHasSsh, sandboxOwner, writeAuthorizedKeys, refreshOwnerSandboxes, sshKeyCount, hasGeneratedKey, readGeneratedKey, createGeneratedKey } = await import('../../services/sandboxSsh')

const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILQbLq+klAOn7bvdZ+bf7t83dWYc3AfKM/YVFsjF6tLa test@p7y'
const LINE = KEY.split(' ').slice(0, 2).join(' ')
const EXTRA = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILQbLq+klAOn7bvdZ+bf7t83dWYc3AfKM/YVFsjF6tLb'

function sandbox(name: string, labels: Record<string, string>, extra?: string) {
  const d = path.join(users, name)
  fs.mkdirSync(d, { recursive: true })
  const lines = Object.entries(labels).map(([k, v]) => `        ${k}: ${JSON.stringify(v)}`).join('\n')
  fs.writeFileSync(path.join(d, 'docker-compose.yml'), `services:\n  sandbox:\n    image: x\n    labels:\n${lines}\n`)
  if (extra) fs.writeFileSync(path.join(d, 'ssh-extra-keys'), extra + '\n')
}

describe('sandbox authorized_keys', () => {
  beforeEach(() => { fs.rmSync(users, { recursive: true, force: true }); fs.rmSync(process.env.SSH_KEYS_FILE!, { force: true }) })
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

  it('knows an SSH sandbox and its owner from its compose labels (quoted owners too)', () => {
    sandbox('p7y-new', { 'p7y.ssh': 'true', 'p7y.owner': 'a+b"c@example.com' })
    sandbox('p7y-old', { 'p7y.owner': 'a+b"c@example.com' })
    expect(sandboxHasSsh('p7y-new', users)).toBe(true)
    expect(sandboxHasSsh('p7y-old', users)).toBe(false)
    expect(sandboxHasSsh('p7y-missing', users)).toBe(false)
    expect(sandboxOwner('p7y-new', users)).toBe('a+b"c@example.com')
  })

  it("writes the owner's keys plus the sandbox's extra keys, one per line", () => {
    addSshKey('alice', KEY, 'laptop')
    sandbox('p7y-a', { 'p7y.ssh': 'true', 'p7y.owner': 'alice' }, EXTRA)
    expect(writeAuthorizedKeys('p7y-a', 'alice', users)).toBe(2)
    expect(fs.readFileSync(path.join(users, 'p7y-a', 'authorized_keys'), 'utf8')).toBe(`${LINE} laptop\n${EXTRA}\n`)
    expect(sshKeyCount('p7y-a', users)).toBe(2)
  })

  it("rewrites only that owner's SSH sandboxes when the owner's keys change", () => {
    sandbox('p7y-a', { 'p7y.ssh': 'true', 'p7y.owner': 'alice' })
    sandbox('p7y-b', { 'p7y.ssh': 'true', 'p7y.owner': 'bob' })
    sandbox('p7y-old', { 'p7y.owner': 'alice' })
    for (const n of ['p7y-a', 'p7y-b']) fs.writeFileSync(path.join(users, n, 'authorized_keys'), '')
    addSshKey('alice', KEY, 'laptop')
    refreshOwnerSandboxes('alice', users)
    expect(fs.readFileSync(path.join(users, 'p7y-a', 'authorized_keys'), 'utf8')).toBe(`${LINE} laptop\n`)
    expect(fs.readFileSync(path.join(users, 'p7y-b', 'authorized_keys'), 'utf8')).toBe('')
    expect(fs.existsSync(path.join(users, 'p7y-old', 'authorized_keys'))).toBe(false)
  })

  // e.g. a sandbox started before its authorized_keys file existed: Docker made a directory there
  it("keeps going when one sandbox's authorized_keys cannot be written, and says which", () => {
    sandbox('p7y-a', { 'p7y.ssh': 'true', 'p7y.owner': 'alice' })
    sandbox('p7y-broken', { 'p7y.ssh': 'true', 'p7y.owner': 'alice' })
    fs.mkdirSync(path.join(users, 'p7y-broken', 'authorized_keys'))
    addSshKey('alice', KEY, 'laptop')
    const errors: string[] = []
    const orig = console.error
    console.error = (...a: unknown[]) => { errors.push(a.join(' ')) }
    try { refreshOwnerSandboxes('alice', users) } finally { console.error = orig }
    expect(fs.readFileSync(path.join(users, 'p7y-a', 'authorized_keys'), 'utf8')).toBe(`${LINE} laptop\n`)
    expect(errors.join('\n')).toContain('p7y-broken')
    expect(fs.readdirSync(path.join(users, 'p7y-broken')).filter(f => f.endsWith('.tmp'))).toEqual([])
  })

  // A single-file bind mount follows the file, not the path: a rename over it would leave a running
  // sandbox reading the old keys (on a Linux Docker engine), so a deleted key would still get in
  it('rewrites authorized_keys in place, so the file a running sandbox has mounted sees the change', () => {
    sandbox('p7y-m', { 'p7y.ssh': 'true', 'p7y.owner': 'alice' })
    const f = path.join(users, 'p7y-m', 'authorized_keys')
    fs.writeFileSync(f, 'old\n')
    const ino = fs.statSync(f).ino
    addSshKey('alice', KEY, 'laptop')
    writeAuthorizedKeys('p7y-m', 'alice', users)
    expect(fs.statSync(f).ino).toBe(ino)
    expect(fs.readFileSync(f, 'utf8')).toBe(`${LINE} laptop\n`)
  })

  it('creates a generated key once: private file, public file, and the public key in authorized_keys', () => {
    sandbox('p7y-g', { 'p7y.ssh': 'true', 'p7y.owner': 'alice' })
    expect(hasGeneratedKey('p7y-g', users)).toBe(false)
    const priv = createGeneratedKey('p7y-g', 'alice', users)
    expect(priv).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----/)
    expect(readGeneratedKey('p7y-g', users)).toBe(priv)
    const pub = fs.readFileSync(path.join(users, 'p7y-g', 'ssh-key.pub'), 'utf8').trim()
    expect(pub).toMatch(/^ssh-ed25519 \S+ p7y-generated$/)
    expect(fs.readFileSync(path.join(users, 'p7y-g', 'authorized_keys'), 'utf8')).toContain(pub)
    expect(() => createGeneratedKey('p7y-g', 'alice', users)).toThrow('exists')
  })

  it('keeps the generated key in authorized_keys when the owner keys change', () => {
    sandbox('p7y-g2', { 'p7y.ssh': 'true', 'p7y.owner': 'alice' })
    createGeneratedKey('p7y-g2', 'alice', users)
    addSshKey('alice', KEY, 'laptop')
    refreshOwnerSandboxes('alice', users)
    const text = fs.readFileSync(path.join(users, 'p7y-g2', 'authorized_keys'), 'utf8')
    expect(text).toContain('p7y-generated')
    expect(text).toContain(`${LINE} laptop`)
  })

  it('writes an empty file when there are no keys (sshd then lets nobody in)', () => {
    sandbox('p7y-e', { 'p7y.ssh': 'true', 'p7y.owner': 'nobody' })
    expect(writeAuthorizedKeys('p7y-e', 'nobody', users)).toBe(0)
    expect(fs.readFileSync(path.join(users, 'p7y-e', 'authorized_keys'), 'utf8')).toBe('')
  })
})

describe('refreshOwnerSandboxes without a directory', () => {
  it("refreshes the owner's SSH sandboxes in the per-owner layout", async () => {
    const { forgetSandboxDir } = await import('../../services/sandboxPaths')
    const saved = process.env.SANDBOXES_DIR
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-owners-'))
    process.env.SANDBOXES_DIR = rootDir; forgetSandboxDir()
    try {
      const d = path.join(rootDir, 'carol', 'p7y-c')
      fs.mkdirSync(d, { recursive: true })
      fs.writeFileSync(path.join(d, 'docker-compose.yml'), 'services:\n  sandbox:\n    labels:\n        p7y.ssh: "true"\n        p7y.owner: "carol"\n')
      addSshKey('carol', KEY, 'laptop')
      refreshOwnerSandboxes('carol')
      expect(fs.readFileSync(path.join(d, 'authorized_keys'), 'utf8')).toBe(`${LINE} laptop\n`)
      expect(sshKeyCount('p7y-c')).toBe(1)
    } finally { process.env.SANDBOXES_DIR = saved; forgetSandboxDir() }
  })
})
