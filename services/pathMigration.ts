import fs from 'fs'
import { composeCreate, composeUp } from './compose'
import { getSandboxState, resolveHostSandboxesDir } from './docker'
import path from 'path'
import { entriesIn, listSandboxDirs } from './sandboxPaths'

// The sandbox files a template bind-mounts from ${sandbox_dir}/ (= <host dir>/<name>/)
const MOUNTED = '(?:certs|daemon\\.json|frps\\.toml|inner|instance-name)'
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The host directory the sandbox's bind mounts point into (the part before `/<name>/`), or null. */
export function mountedUsersDir(text: string, name: string): string | null {
  const m = text.match(new RegExp(`^\\s*-\\s*["']?(.+?)/${escapeRegExp(name)}/${MOUNTED}`, 'm'))
  return m ? m[1] : null
}

/** The compose file with every `<from>/<name>/` bind source moved to `<to>/<name>/`. */
export function withUsersDir(text: string, name: string, from: string, to: string): string {
  return text.split(`${from}/${name}/`).join(`${to}/${name}/`)
}

/**
 * Sandbox compose files hold absolute host paths (${sandbox_dir}), so a checkout that was moved or renamed
 * (leander/ → p7y/) leaves every sandbox pointing at a directory that no longer has its files: Docker then creates
 * empty directories there and the sandbox fails to start ("not a directory"). Rewrites those paths to the current
 * directory (<host sandboxes dir>/<owner>/<name>/) and recreates the sandbox's containers: started if it was running
 * or its last start failed, otherwise left stopped (asleep); a deep-sleeping one only gets the file rewritten.
 * Sandboxes not moved into opt/sandboxes yet are left to the startup move. `flatDir` + `hostDir`: one flat directory
 * whose sandboxes' mounts should point at `hostDir` (tests). Returns the migrated sandbox names.
 */
export async function migrateHostPaths(flatDir?: string, hostDir?: string): Promise<string[]> {
  const host = hostDir ?? await resolveHostSandboxesDir()
  // The resolvers fall back to the container path when they cannot tell: never rewrite to a guess
  if (host === '/opt/sandboxes' || host === '/opt/users') return []
  const entries = flatDir === undefined ? listSandboxDirs().filter(e => !e.legacy) : entriesIn(flatDir)
  const migrated: string[] = []
  for (const { name, dir } of entries) {
    const composePath = `${dir}/docker-compose.yml`
    // The owner directory the files are really in (not the label: one it cannot read would point elsewhere)
    const target = flatDir === undefined ? `${host}/${path.posix.basename(path.posix.dirname(dir))}` : host
    let original: string
    try { original = fs.readFileSync(composePath, 'utf8') } catch { continue }
    const from = mountedUsersDir(original, name)
    if (!from || from === target) continue
    try {
      fs.writeFileSync(composePath, withUsersDir(original, name, from, target))
      const state = await getSandboxState(name)
      if (state) {
        if (state.status === 'running' || state.error) await composeUp(composePath)
        else await composeCreate(composePath)
      }
      migrated.push(name)
      console.log(`[paths] ${name}: mounts moved from ${from} to ${target}`)
    } catch (err) {
      fs.writeFileSync(composePath, original) // retried on the next start
      console.error(`[paths] ${name} failed:`, err instanceof Error ? err.message : err)
    }
  }
  return migrated
}
