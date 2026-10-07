import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

/** A runtime's or template's name: its file or directory name (also keeps paths inside the catalog). */
export const CATALOG_NAME = /^[a-z0-9][a-z0-9_-]*$/

/** How a sandbox runs: runtimes/<name>.yaml. */
export interface SandboxRuntime {
  name: string
  description: string
  /** The sandbox's own compose file: the DinD container, frps, socat, Traefik and Sablier labels. */
  docker_compose: Record<string, unknown>
  /** Extra dockerd settings merged into the generated daemon.json (e.g. TLS for images that run plain `dockerd`). */
  daemon_json?: Record<string, unknown>
}

const defaultDir = () => process.env.RUNTIMES_DIR ?? '/app/runtimes'

export function loadRuntime(name: string, dir = defaultDir()): SandboxRuntime {
  const file = path.join(dir, `${name}.yaml`)
  if (!CATALOG_NAME.test(name) || !fs.existsSync(file)) throw new Error(`Runtime not found: ${name}`)
  const r = (yaml.load(fs.readFileSync(file, 'utf8')) ?? {}) as Partial<SandboxRuntime>
  return {
    name,
    description: r.description ?? name,
    docker_compose: r.docker_compose ?? {},
    ...(r.daemon_json ? { daemon_json: r.daemon_json } : {}),
  }
}

/** Loads each entry; one that does not parse is logged and left out, so it cannot hide the rest. */
export function loadAll<T>(kind: string, names: string[], load: (name: string) => T): T[] {
  return names.flatMap(name => {
    try { return [load(name)] } catch (err) {
      console.error(`[catalog] ${kind} ${name} skipped: ${err instanceof Error ? err.message : err}`)
      return []
    }
  })
}

export function listRuntimes(dir = defaultDir()): SandboxRuntime[] {
  if (!fs.existsSync(dir)) return []
  const names = fs.readdirSync(dir).filter(f => f.endsWith('.yaml')).map(f => path.basename(f, '.yaml')).filter(n => CATALOG_NAME.test(n))
  return loadAll('runtime', names, n => loadRuntime(n, dir)).sort((a, b) => a.name.localeCompare(b.name))
}
