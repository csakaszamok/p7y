import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p9m-sandboxssh-'))
process.env.SSH_KEYS_FILE = path.join(root, 'ssh-keys.json')
const users = path.join(root, 'users')
const { addSshKey } = await import('../../services/sshKeys')
const { sandboxHasSsh, sandboxOwner, writeAuthorizedKeys, refreshOwnerSandboxes, sshKeyCount, hasGeneratedKey, readGeneratedKey, createGeneratedKey } = await import('../../services/sandboxSsh')

const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILQbLq+klAOn7bvdZ+bf7t83dWYc3AfKM/YVFsjF6tLa test@p9m'
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
    sandbox('p9m-new', { 'p9m.ssh': 'true', 'p9m.owner': 'a+b"c@example.com' })
    sandbox('p9m-old', { 'p9m.owner': 'a+b"c@example.com' })
    expect(sandboxHasSsh('p9m-new', users)).toBe(true)
    expect(sandboxHasSsh('p9m-old', users)).toBe(false)
    expect(sandboxHasSsh('p9m-missing', users)).toBe(false)
    expect(sandboxOwner('p9m-new', users)).toBe('a+b"c@example.com')
  })

  it("writes the owner's keys plus the sandbox's extra keys, one per line", () => {
    addSshKey('alice', KEY, 'laptop')
    sandbox('p9m-a', { 'p9m.ssh': 'true', 'p9m.owner': 'alice' }, EXTRA)
    expect(writeAuthorizedKeys('p9m-a', 'alice', users)).toBe(2)
    expect(fs.readFileSync(path.join(users, 'p9m-a', 'authorized_keys'), 'utf8')).toBe(`${LINE} laptop\n${EXTRA}\n`)
    expect(sshKeyCount('p9m-a', users)).toBe(2)
  })

  it("rewrites only that owner's SSH sandboxes when the owner's keys change", () => {
    sandbox('p9m-a', { 'p9m.ssh': 'true', 'p9m.owner': 'alice' })
    sandbox('p9m-b', { 'p9m.ssh': 'true', 'p9m.owner': 'bob' })
    sandbox('p9m-old', { 'p9m.owner': 'alice' })
    for (const n of ['p9m-a', 'p9m-b']) fs.writeFileSync(path.join(users, n, 'authorized_keys'), '')
    addSshKey('alice', KEY, 'laptop')
    refreshOwnerSandboxes('alice', users)
    expect(fs.readFileSync(path.join(users, 'p9m-a', 'authorized_keys'), 'utf8')).toBe(`${LINE} laptop\n`)
    expect(fs.readFileSync(path.join(users, 'p9m-b', 'authorized_keys'), 'utf8')).toBe('')
    expect(fs.existsSync(path.join(users, 'p9m-old', 'authorized_keys'))).toBe(false)
  })

  // e.g. a sandbox started before its authorized_keys file existed: Docker made a directory there
  it("keeps going when one sandbox's authorized_keys cannot be written, and says which", () => {
    sandbox('p9m-a', { 'p9m.ssh': 'true', 'p9m.owner': 'alice' })
    sandbox('p9m-broken', { 'p9m.ssh': 'true', 'p9m.owner': 'alice' })
    fs.mkdirSync(path.join(users, 'p9m-broken', 'authorized_keys'))
    addSshKey('alice', KEY, 'laptop')
    const errors: string[] = []
    const orig = console.error
    console.error = (...a: unknown[]) => { errors.push(a.join(' ')) }
    try { refreshOwnerSandboxes('alice', users) } finally { console.error = orig }
    expect(fs.readFileSync(path.join(users, 'p9m-a', 'authorized_keys'), 'utf8')).toBe(`${LINE} laptop\n`)
    expect(errors.join('\n')).toContain('p9m-broken')
    expect(fs.readdirSync(path.join(users, 'p9m-broken')).filter(f => f.endsWith('.tmp'))).toEqual([])
  })

  // A single-file bind mount follows the file, not the path: a rename over it would leave a running
  // sandbox reading the old keys (on a Linux Docker engine), so a deleted key would still get in
  it('rewrites authorized_keys in place, so the file a running sandbox has mounted sees the change', () => {
    sandbox('p9m-m', { 'p9m.ssh': 'true', 'p9m.owner': 'alice' })
    const f = path.join(users, 'p9m-m', 'authorized_keys')
    fs.writeFileSync(f, 'old\n')
    const ino = fs.statSync(f).ino
    addSshKey('alice', KEY, 'laptop')
    writeAuthorizedKeys('p9m-m', 'alice', users)
    expect(fs.statSync(f).ino).toBe(ino)
    expect(fs.readFileSync(f, 'utf8')).toBe(`${LINE} laptop\n`)
  })

  it('creates a generated key once: private file, public file, and the public key in authorized_keys', () => {
    sandbox('p9m-g', { 'p9m.ssh': 'true', 'p9m.owner': 'alice' })
    expect(hasGeneratedKey('p9m-g', users)).toBe(false)
    const priv = createGeneratedKey('p9m-g', 'alice', users)
    expect(priv).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----/)
    expect(readGeneratedKey('p9m-g', users)).toBe(priv)
    const pub = fs.readFileSync(path.join(users, 'p9m-g', 'ssh-key.pub'), 'utf8').trim()
    expect(pub).toMatch(/^ssh-ed25519 \S+ p9m-generated$/)
    expect(fs.readFileSync(path.join(users, 'p9m-g', 'authorized_keys'), 'utf8')).toContain(pub)
    expect(() => createGeneratedKey('p9m-g', 'alice', users)).toThrow('exists')
  })

  it('keeps the generated key in authorized_keys when the owner keys change', () => {
    sandbox('p9m-g2', { 'p9m.ssh': 'true', 'p9m.owner': 'alice' })
    createGeneratedKey('p9m-g2', 'alice', users)
    addSshKey('alice', KEY, 'laptop')
    refreshOwnerSandboxes('alice', users)
    const text = fs.readFileSync(path.join(users, 'p9m-g2', 'authorized_keys'), 'utf8')
    expect(text).toContain('p9m-generated')
    expect(text).toContain(`${LINE} laptop`)
  })

  it('writes an empty file when there are no keys (sshd then lets nobody in)', () => {
    sandbox('p9m-e', { 'p9m.ssh': 'true', 'p9m.owner': 'nobody' })
    expect(writeAuthorizedKeys('p9m-e', 'nobody', users)).toBe(0)
    expect(fs.readFileSync(path.join(users, 'p9m-e', 'authorized_keys'), 'utf8')).toBe('')
  })
})

describe('refreshOwnerSandboxes without a directory', () => {
  it("refreshes the owner's SSH sandboxes in the per-owner layout", async () => {
    const { forgetSandboxDir } = await import('../../services/sandboxPaths')
    const saved = process.env.SANDBOXES_DIR
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p9m-owners-'))
    process.env.SANDBOXES_DIR = rootDir; forgetSandboxDir()
    try {
      const d = path.join(rootDir, 'carol', 'p9m-c')
      fs.mkdirSync(d, { recursive: true })
      fs.writeFileSync(path.join(d, 'docker-compose.yml'), 'services:\n  sandbox:\n    labels:\n        p9m.ssh: "true"\n        p9m.owner: "carol"\n')
      addSshKey('carol', KEY, 'laptop')
      refreshOwnerSandboxes('carol')
      expect(fs.readFileSync(path.join(d, 'authorized_keys'), 'utf8')).toBe(`${LINE} laptop\n`)
      expect(sshKeyCount('p9m-c')).toBe(1)
    } finally { process.env.SANDBOXES_DIR = saved; forgetSandboxDir() }
  })
})
