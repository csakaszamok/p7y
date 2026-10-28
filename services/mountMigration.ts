import fs from 'fs'
import { composeCreate, composeUp } from './compose'
import { getSandboxState } from './docker'
import { entriesIn, listSandboxDirs } from './sandboxPaths'

// `- <dir>/certs:/certs` and `- <dir>/inner:/inner`, quoted (as in runtimes/*.yaml) or not (after yaml.dump)
const CERTS = /^(\s*-\s*)(["']?)(\S+\/certs):\/certs\2\s*$/
const INNER = /^(\s*-\s*)(["']?)(\S+\/inner):\/inner\2\s*$/

/** The compose file with the sandbox's /inner read-only and, of its /certs, only its dockerd's certificate, read-only. */
export function withReadOnlyMounts(text: string): string {
  return text.split('\n').map(line => {
    const cr = line.endsWith('\r') ? '\r' : ''
    const l = cr ? line.slice(0, -1) : line
    let m = l.match(CERTS)
    if (m) return `${m[1]}${m[2]}${m[3]}/server:/certs/server:ro${m[2]}${cr}`
    m = l.match(INNER)
    return m ? `${m[1]}${m[2]}${m[3]}:/inner:ro${m[2]}${cr}` : line
  }).join('\n')
}

/**
 * Before 0.12.22 a sandbox had its /inner and /certs read-write, and Purgatorium reads and writes files there as root
 * in its own file system: root in the sandbox could swap one for a symlink to a file of Purgatorium's. Rewrites the
 * sandboxes made before to the read-only mounts the runtimes now have and recreates their containers: started if it
 * was running or its last start failed, otherwise left stopped (asleep); a deep-sleeping one only gets the file
 * rewritten. Returns the migrated sandbox names.
 */
export async function migrateReadOnlyMounts(flatDir?: string): Promise<string[]> {
  const entries = flatDir === undefined ? listSandboxDirs() : entriesIn(flatDir)
  const migrated: string[] = []
  for (const { name, dir } of entries) {
    const composePath = `${dir}/docker-compose.yml`
    let original: string
    try { original = fs.readFileSync(composePath, 'utf8') } catch { continue }
    const next = withReadOnlyMounts(original)
    if (next === original) continue
    try {
      fs.writeFileSync(composePath, next)
      const state = await getSandboxState(name)
      if (state) {
        if (state.status === 'running' || state.error) await composeUp(composePath)
        else await composeCreate(composePath)
      }
      migrated.push(name)
      console.log(`[mounts] ${name}: /inner and /certs read-only`)
    } catch (err) {
      fs.writeFileSync(composePath, original) // retried on the next start
      console.error(`[mounts] ${name} failed:`, err instanceof Error ? err.message : err)
    }
  }
  return migrated
}
