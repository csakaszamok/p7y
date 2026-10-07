import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { readLabel } from './naming'
import { sshKeysOf } from './sshKeys'
import { generateSshKeyPair } from './sshKeygen'
import { entriesIn, sandboxParent } from './sandboxPaths'


function labelsOf(name: string, usersDir: string): Record<string, string> {
  try {
    const c = yaml.load(fs.readFileSync(path.join(usersDir, name, 'docker-compose.yml'), 'utf8')) as { services?: { sandbox?: { labels?: Record<string, string> } } } | null
    return c?.services?.sandbox?.labels ?? {}
  } catch { return {} }
}

/** Created with SSH (runtime label p7y.ssh): sandboxes from before have no sshd. */
export function sandboxHasSsh(name: string, usersDir = sandboxParent(name)): boolean {
  return String(readLabel(labelsOf(name, usersDir), 'ssh')) === 'true'
}

export function sandboxOwner(name: string, usersDir = sandboxParent(name)): string | null {
  return readLabel(labelsOf(name, usersDir), 'owner') ?? null
}

/** authorized_keys = the owner's keys (named) + the keys given when the sandbox was created. sshd reads it on every login. */
export function writeAuthorizedKeys(name: string, owner: string, usersDir = sandboxParent(name)): number {
  const dir = path.join(usersDir, name)
  const extraFile = path.join(dir, 'ssh-extra-keys')
  const extra = fs.existsSync(extraFile) ? fs.readFileSync(extraFile, 'utf8').split('\n').map(l => l.trim()).filter(Boolean) : []
  const genPub = path.join(dir, 'ssh-key.pub')
  const generated = fs.existsSync(genPub) ? [fs.readFileSync(genPub, 'utf8').trim()].filter(Boolean) : []
  const lines = [...sshKeysOf(owner).map(k => `${k.line} ${k.name}`), ...extra, ...generated]
  // In place, not tmp + rename: the sandbox has this one file bind-mounted, and such a mount follows
  // the file, not the path — after a rename a running sandbox (Linux engine) would keep the old keys.
  // sshd reads it on every login, so the worst case is one login during the write.
  fs.writeFileSync(path.join(dir, 'authorized_keys'), lines.map(l => `${l}\n`).join(''))
  return lines.length
}

export function refreshOwnerSandboxes(owner: string, flatDir?: string): void {
  for (const e of entriesIn(flatDir)) {
    const name = e.name, usersDir = path.dirname(e.dir)
    if (!sandboxHasSsh(name, usersDir) || sandboxOwner(name, usersDir) !== owner) continue
    // One sandbox that cannot take it (e.g. Docker made a directory where the file belongs) must not stop the rest
    try { writeAuthorizedKeys(name, owner, usersDir) } catch (err) {
      console.error(`[ssh-keys] ${name}: could not update authorized_keys: ${err instanceof Error ? err.message : err}`)
    }
  }
}

export function sshKeyCount(name: string, usersDir = sandboxParent(name)): number {
  try { return fs.readFileSync(path.join(usersDir, name, 'authorized_keys'), 'utf8').split('\n').filter(l => l.trim()).length } catch { return 0 }
}

const keyFile = (name: string, usersDir: string) => path.join(usersDir, name, 'ssh-key')

export function hasGeneratedKey(name: string, usersDir = sandboxParent(name)): boolean {
  return fs.existsSync(keyFile(name, usersDir))
}

export function readGeneratedKey(name: string, usersDir = sandboxParent(name)): string | null {
  try { return fs.readFileSync(keyFile(name, usersDir), 'utf8') } catch { return null }
}

/** The sandbox's own key pair (for users who have none): the public half goes into authorized_keys. */
export function createGeneratedKey(name: string, owner: string, usersDir = sandboxParent(name)): string {
  if (hasGeneratedKey(name, usersDir)) throw new Error('exists')
  const { publicKey, privateKey } = generateSshKeyPair()
  fs.writeFileSync(keyFile(name, usersDir), privateKey, { mode: 0o600 })
  fs.writeFileSync(`${keyFile(name, usersDir)}.pub`, `${publicKey}\n`)
  writeAuthorizedKeys(name, owner, usersDir)
  return privateKey
}
