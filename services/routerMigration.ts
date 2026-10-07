import fs from 'fs'
import yaml from 'js-yaml'
import { composeUpService } from './compose'
import { nudgeTraefik } from './project'
import { listManagedContainers } from './docker'
import { entriesIn } from './sandboxPaths'

type Services = Record<string, { labels?: Record<string, string> } | undefined>

const entrypointsLabel = (name: string) => `traefik.http.routers.frps-${name}.entrypoints`

/** The compose file with the sandbox router on web and websecure, or null if it needs no change. */
export function withWebsecure(text: string, name: string): string | null {
  let doc: { services?: Services } | null
  try { doc = yaml.load(text) as { services?: Services } | null } catch { return null }
  const labels = doc?.services?.socat?.labels
  if (labels?.[entrypointsLabel(name)] !== 'web') return null
  labels[entrypointsLabel(name)] = 'web,websecure'
  return yaml.dump(doc, { lineWidth: -1 })
}

const portLabel = (name: string) => `traefik.http.services.frps-${name}.loadbalancer.server.port`
const urlLabel = (name: string) => `traefik.http.services.frps-${name}.loadbalancer.server.url`

/**
 * The compose file with the sandbox's service pointing at socat by name, or null if it needs no change.
 * On the container's port, Traefik learned a woken container's address only ~1.5 s after Sablier let
 * the request through, and meanwhile sent it to the stopped container's empty address (500).
 */
export function withSocatUrl(text: string, name: string): string | null {
  let doc: { services?: Services } | null
  try { doc = yaml.load(text) as { services?: Services } | null } catch { return null }
  const labels = doc?.services?.socat?.labels
  if (!labels || labels[portLabel(name)] === undefined) return null
  delete labels[portLabel(name)]
  labels[urlLabel(name)] = `http://${name}-socat:8080`
  return yaml.dump(doc, { lineWidth: -1 })
}

/** The compose file without allownonrunning on socat, or null if it needs no change (see the runtimes). */
export function withoutAllowNonRunning(text: string, _name: string): string | null {
  let doc: { services?: Services } | null
  try { doc = yaml.load(text) as { services?: Services } | null } catch { return null }
  const labels = doc?.services?.socat?.labels
  if (!labels || labels['traefik.docker.allownonrunning'] === undefined) return null
  delete labels['traefik.docker.allownonrunning']
  return yaml.dump(doc, { lineWidth: -1 })
}

/**
 * Sandboxes created before HTTPS support only route `web`; an https:// request
 * then never reaches them. Adds `websecure` to their router and recreates only
 * the socat container that carries it (started if the sandbox runs, left
 * stopped if it sleeps; a deep-sleeping one picks it up on its next wake).
 * It also points the service at socat by name (withSocatUrl) and drops allownonrunning (withoutAllowNonRunning),
 * in the same recreate.
 * Returns the migrated sandbox names.
 */
export async function migrateRouters(usersDir?: string): Promise<string[]> {
  const entries = entriesIn(usersDir)
  if (!entries.length) return []
  const status = new Map((await listManagedContainers()).map(c => [c.name, c.status]))
  const migrated: string[] = []
  let recreated = false
  for (const { name, dir } of entries) {
    const composePath = `${dir}/docker-compose.yml`
    let original: string
    try { original = fs.readFileSync(composePath, 'utf8') } catch { continue }
    let updated: string | null = null
    for (const step of [withWebsecure, withSocatUrl, withoutAllowNonRunning]) {
      const next = step(updated ?? original, name)
      if (next) updated = next
    }
    if (!updated) continue
    try {
      fs.writeFileSync(composePath, updated)
      const s = status.get(name)
      if (s !== undefined) {
        recreated = true
        await composeUpService(composePath, 'socat', s === 'running')
      }
      migrated.push(name)
      console.log(`[routers] ${name}: router updated`)
    } catch (err) {
      fs.writeFileSync(composePath, original) // retried on the next start
      console.error(`[routers] ${name} failed:`, err instanceof Error ? err.message : err)
    }
  }
  if (recreated) await nudgeTraefik()
  return migrated
}
