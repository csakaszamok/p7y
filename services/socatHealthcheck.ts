import fs from 'fs'
import yaml from 'js-yaml'
import { composeUpService } from './compose'
import { listManagedContainers } from './docker'
import { entriesIn } from './sandboxPaths'

type Check = { interval?: string; retries?: number; start_interval?: string }

/**
 * The compose file with socat's check every 10 s once up (as the runtimes write it now), or null: not the runtimes'
 * old every-2-s check, already done, or no start_interval (an engine below 25 checks every 2 s throughout, else a
 * wake would wait for the next check).
 */
export function withSlowerSocatCheck(text: string): string | null {
  let doc: { services?: Record<string, { healthcheck?: Check } | undefined> } | null
  try { doc = yaml.load(text) as typeof doc } catch { return null }
  const check = doc?.services?.socat?.healthcheck
  if (!check || check.interval !== '2s' || check.retries !== 60 || check.start_interval === undefined) return null
  check.interval = '10s'
  check.retries = 12
  return yaml.dump(doc, { lineWidth: -1 })
}

/**
 * Sandboxes created while socat checked its tunnel every 2 s: every 10 s from now on (each check is a `docker exec`,
 * which kept dockerd busy with many sandboxes). Recreates socat: started if the sandbox runs (its app addresses are
 * gone for a second or two), left stopped if it sleeps. Returns the migrated sandbox names.
 */
export async function migrateSocatCheck(usersDir?: string): Promise<string[]> {
  const entries = entriesIn(usersDir)
  if (!entries.length) return []
  const status = new Map((await listManagedContainers()).map(c => [c.name, c.status]))
  const migrated: string[] = []
  for (const { name, dir } of entries) {
    const composePath = `${dir}/docker-compose.yml`
    let compose: string
    try { compose = fs.readFileSync(composePath, 'utf8') } catch { continue }
    const next = withSlowerSocatCheck(compose)
    if (!next) continue
    try {
      fs.writeFileSync(composePath, next)
      const s = status.get(name)
      if (s !== undefined) await composeUpService(composePath, 'socat', s === 'running')
      migrated.push(name)
    } catch (err) {
      fs.writeFileSync(composePath, compose) // retried on the next start
      console.error(`[socat] ${name} failed:`, err instanceof Error ? err.message : err)
    }
  }
  if (migrated.length) console.log(`[socat] ${migrated.length} sandbox(es) check their tunnel every 10 s now`)
  return migrated
}
