import fs from 'fs'
import path from 'path'
import { composeUp, composeCreate } from './compose'
import { getSandboxState, resolveHostSandboxesDir } from './docker'
import { mountedUsersDir, withUsersDir } from './pathMigration'
import { archiveDir, archiveRoot, entriesIn, forgetSandboxDir, legacyUsersDir, newSandboxDir, ownerDirName, ownerOfCompose, sandboxesMounted } from './sandboxPaths'

const rmEmpty = (dir: string) => { try { if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir) } catch { /* gone or not empty */ } }

/**
 * Moves sandboxes from the flat opt/users/<name>/ into opt/sandboxes/<owner>/<name>/: copies the directory into a
 * hidden staging dir (two mounts, so no rename across them), points the compose file's bind mounts at the new host
 * path, renames the staging dir into place (a half copy is never seen), recreates the containers (running, or last
 * start failed → started; asleep → created stopped; deep sleep → nothing) and only then removes the old directory.
 * A complete target from an earlier run is used as it is: it is the newer one. On a failure before the containers use
 * the new directory they are brought back on the old one, and the next start tries again. Returns the moved names.
 */
export async function migrateSandboxDirs(deps: {
  hostDir?: () => Promise<string>
  status?: (name: string) => Promise<{ status: string; error?: unknown } | null>
  up?: (composePath: string) => Promise<void>
  create?: (composePath: string) => Promise<void>
  mounted?: () => boolean
  log?: (s: string) => void
} = {}): Promise<string[]> {
  const log = deps.log ?? (s => console.log(`[sandbox-dirs] ${s}`))
  const status = deps.status ?? getSandboxState
  const up = deps.up ?? composeUp
  const create = deps.create ?? composeCreate
  // Straight from opt/users (a dir with a compose file is a sandbox there)
  const legacy = entriesIn(legacyUsersDir()).filter(e => fs.existsSync(`${e.dir}/docker-compose.yml`))
  if (!legacy.length) return []
  if (!(deps.mounted ?? sandboxesMounted)()) {
    log(`opt/sandboxes is not mounted from the host (see docker-compose.yml): ${legacy.length} sandbox(es) stay in opt/users for now`)
    return []
  }
  const host = await (deps.hostDir ?? resolveHostSandboxesDir)()
  if (host === '/opt/sandboxes') {
    log(`cannot tell the host path of opt/sandboxes (set HOST_SANDBOXES_DIR): ${legacy.length} sandbox(es) stay in opt/users for now`)
    return []
  }
  const moved: string[] = []
  for (const { name, dir } of legacy) {
    const text = fs.readFileSync(`${dir}/docker-compose.yml`, 'utf8')
    const owner = ownerOfCompose(text)
    const target = newSandboxDir(owner, name)
    const staging = `${path.posix.dirname(target)}/.${name}.moving`
    const from = mountedUsersDir(text, name)
    if (!from && text.includes(`/${name}/`)) {
      log(`${name}: its bind mounts are not the usual ones and cannot be rewritten: left in opt/users`)
      continue
    }
    const fresh = !fs.existsSync(`${target}/docker-compose.yml`)
    // How the containers were brought up from the new dir: undone on the old one if the move fails half-way
    let recreate: ((composePath: string) => Promise<void>) | null = null
    try {
      if (fresh) {
        fs.rmSync(staging, { recursive: true, force: true })
        fs.rmSync(target, { recursive: true, force: true })
        fs.cpSync(dir, staging, { recursive: true })
        if (from) fs.writeFileSync(`${staging}/docker-compose.yml`, withUsersDir(text, name, from, `${host}/${ownerDirName(owner)}`))
        fs.renameSync(staging, target)
      }
      forgetSandboxDir(name)
      const state = await status(name)
      recreate = state?.status === 'running' || state?.error ? up : state ? create : null
      if (recreate) await recreate(`${target}/docker-compose.yml`)
    } catch (err) {
      // Containers (partly) recreated from the new dir would point at removed files: back on the old one first
      if (fresh && recreate) await recreate(`${dir}/docker-compose.yml`).catch(() => {})
      try {
        fs.rmSync(staging, { recursive: true, force: true })
        if (fresh) fs.rmSync(target, { recursive: true, force: true })
        rmEmpty(path.posix.dirname(target))
      } catch { /* a target nothing uses: replaced at the next start */ }
      forgetSandboxDir(name)
      log(`${name}: not moved, tried again at the next start: ${err instanceof Error ? err.message : err}`)
      continue
    }
    // Its containers use the new dir now: the move stands. Without its compose file the old dir is no longer a
    // sandbox; the rest is removed if it can be (if not even the compose file goes, the complete target wins next time).
    try {
      fs.rmSync(`${dir}/docker-compose.yml`, { force: true })
      fs.rmSync(dir, { recursive: true, force: true })
    } catch (err) {
      log(`${name}: the old directory opt/users/${name} could not be removed, remove it by hand: ${err instanceof Error ? err.message : err}`)
    }
    forgetSandboxDir(name)
    moved.push(name)
    log(`${name}: moved to opt/sandboxes/${ownerDirName(owner)}/`)
  }
  return moved
}

/** The owner of an archive entry: manifest `owner`, else its compose file's label (admin without one). */
function archiveOwner(entry: string): string {
  try {
    const m = JSON.parse(fs.readFileSync(`${entry}/manifest.json`, 'utf8')) as { owner?: unknown }
    if (typeof m.owner === 'string' && m.owner) return m.owner
  } catch { /* the label */ }
  try { return ownerOfCompose(fs.readFileSync(`${entry}/config/docker-compose.yml`, 'utf8')) } catch { return 'admin' }
}

/**
 * Moves flat archives (opt/archive/<name>-<date>/, with a manifest) under opt/archive/<owner>/ (same mount: a
 * rename). Owner directories (no manifest) and saves of orphan volumes (`_orphan-…`) stay. Returns the moved entries.
 */
export function migrateArchives(log: (s: string) => void = s => console.log(`[sandbox-dirs] ${s}`)): string[] {
  const root = archiveDir()
  let names: string[]
  try { names = fs.readdirSync(root).map(String) } catch { return [] }
  const moved: string[] = []
  for (const n of names) {
    const entry = `${root}/${n}`
    if (n.startsWith('_') || !fs.existsSync(`${entry}/manifest.json`)) continue
    try {
      const dest = archiveRoot(archiveOwner(entry))
      fs.mkdirSync(dest, { recursive: true })
      fs.renameSync(entry, `${dest}/${n}`)
      moved.push(n)
    } catch (err) {
      log(`archive ${n}: not moved: ${err instanceof Error ? err.message : err}`)
    }
  }
  if (moved.length) log(`${moved.length} archive(s) moved under their owner's directory`)
  return moved
}

