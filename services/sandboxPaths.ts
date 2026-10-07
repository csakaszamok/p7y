import fs from 'fs'
import path from 'path'

/**
 * Where a sandbox's files live: opt/sandboxes/<owner>/<name>/ (in the container /opt/sandboxes/…), archives under
 * opt/archive/<owner>/. Sandboxes from before this layout sit in the flat opt/users/<name>/ until the startup move
 * (sandboxDirMigration) takes them over; every lookup falls back to them meanwhile.
 */

/** A sandbox directory name (= sandbox name). */
export const SANDBOX_NAME = /^[a-z0-9][a-z0-9_-]{0,70}$/

export const sandboxesDir = () => process.env.SANDBOXES_DIR ?? '/opt/sandboxes'
export const legacyUsersDir = () => process.env.LEGACY_USERS_DIR ?? '/opt/users'
export const archiveDir = () => process.env.ARCHIVE_DIR ?? '/opt/archive'

/** The directory name for an owner id (admin, or an OIDC e-mail): safe on any file system. */
export function ownerDirName(owner: string): string {
  const s = owner.toLowerCase().replace(/[^a-z0-9._@-]/g, '_')
  return s === '' || s === '.' || s === '..' ? '_' : s
}

/**
 * The owner label of a sandbox compose file (p7y. or the pre-rename leander.), admin without one. Created ones are
 * JSON-quoted (an e-mail may hold ' or "); older ones may be bare or single-quoted.
 */
export function ownerOfCompose(text: string): string {
  const v = /^\s*(?:p7y|leander)\.owner:\s*(.+?)\s*$/m.exec(text)?.[1]
  if (!v) return 'admin'
  if (v.startsWith('"')) {
    try { const o: unknown = JSON.parse(v); if (typeof o === 'string' && o) return o } catch { /* below */ }
  }
  if (v.length > 1 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'") || 'admin'
  return v.replace(/^["']|["']$/g, '') || 'admin'
}

/**
 * Whether opt/sandboxes is a mount of its own (a bind from the host), not p7y's container layer, where files would be
 * lost with the container and the host paths in compose files would not exist. An explicit SANDBOXES_DIR is taken as is.
 */
export function sandboxesMounted(): boolean {
  if (process.env.SANDBOXES_DIR) return true
  try { return fs.statSync(sandboxesDir()).dev !== fs.statSync('/').dev } catch { return false }
}

export interface SandboxDirEntry { name: string; owner: string; dir: string; legacy: boolean }

const subdirs = (p: string): string[] => {
  try { return fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) } catch { return [] }
}
// A sandbox's owner never changes: read once per directory (listings run on every wake request)
const owners = new Map<string, string>()
const ownerOfDir = (dir: string) => {
  let o = owners.get(dir)
  if (o === undefined) {
    try { o = ownerOfCompose(fs.readFileSync(`${dir}/docker-compose.yml`, 'utf8')) } catch { return 'admin' }
    owners.set(dir, o)
  }
  return o
}

let cache = new Map<string, string>()

/** Every sandbox directory: the per-owner layout, then legacy flat ones not moved yet. */
export function listSandboxDirs(): SandboxDirEntry[] {
  const seen = new Map<string, SandboxDirEntry>()
  for (const o of subdirs(sandboxesDir())) {
    for (const name of subdirs(`${sandboxesDir()}/${o}`)) {
      if (!SANDBOX_NAME.test(name) || seen.has(name)) continue
      const dir = `${sandboxesDir()}/${o}/${name}`
      seen.set(name, { name, owner: ownerOfDir(dir), dir, legacy: false })
    }
  }
  for (const name of subdirs(legacyUsersDir())) {
    if (!SANDBOX_NAME.test(name) || seen.has(name)) continue
    const dir = `${legacyUsersDir()}/${name}`
    // A leftover of a move (no compose file) is not a sandbox: it must not hold the name
    if (!fs.existsSync(`${dir}/docker-compose.yml`)) continue
    seen.set(name, { name, owner: ownerOfDir(dir), dir, legacy: true })
  }
  cache = new Map([...seen.values()].map(e => [e.name, e.dir]))
  return [...seen.values()]
}

/** Every sandbox (listSandboxDirs), or the sandboxes of one flat directory when given (as the old opt/users was). */
export function entriesIn(flatDir?: string): SandboxDirEntry[] {
  if (flatDir === undefined) return listSandboxDirs()
  return subdirs(flatDir).filter(n => SANDBOX_NAME.test(n))
    .map(name => ({ name, owner: ownerOfDir(`${flatDir}/${name}`), dir: `${flatDir}/${name}`, legacy: true }))
}

const movedAlready = (name: string) => subdirs(sandboxesDir()).some(o => fs.existsSync(`${sandboxesDir()}/${o}/${name}`))

/** The sandbox's directory (per-owner layout first, then legacy), or null. */
export function sandboxDir(name: string): string | null {
  if (!SANDBOX_NAME.test(name)) return null
  const hit = cache.get(name)
  // A cached legacy path is checked again: the startup move may have taken it over meanwhile
  if (hit && fs.existsSync(hit) && !(hit.startsWith(`${legacyUsersDir()}/`) && movedAlready(name))) return hit
  listSandboxDirs()
  return cache.get(name) ?? null
}

/** The directory holding the sandbox's directory; for an unknown sandbox the legacy one (its paths then do not exist). */
export function sandboxParent(name: string): string {
  const d = sandboxDir(name)
  // posix: these are container paths, also when the tests run on Windows
  return d ? path.posix.dirname(d) : legacyUsersDir()
}

export const newSandboxDir = (owner: string, name: string) => `${sandboxesDir()}/${ownerDirName(owner)}/${name}`
export const archiveRoot = (owner: string) => `${archiveDir()}/${ownerDirName(owner)}`

/** Drops a cached lookup (all of them without a name). */
export function forgetSandboxDir(name?: string): void {
  if (name) { const d = cache.get(name); if (d) owners.delete(d); cache.delete(name) }
  else { cache = new Map(); owners.clear() }
}
