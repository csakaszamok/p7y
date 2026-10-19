import { listSandboxDirs } from '../sandboxPaths'
import { rememberedApps, appLinks, type AppLink } from '../appLinks'
import { listManagedContainers } from '../docker'
import { sandboxAccess } from './hosts'

/**
 * What Traefik's HTTP provider reads every 2 s: access-<name> for every sandbox, used by its router before Sablier.
 * All its apps public: a no-op (it only removes a client-sent X-P7y-User), so the apps do not depend on Purgatory;
 * otherwise a forwardAuth to /auth/app. Every known sandbox has one: a router referencing a missing one is disabled.
 */
export interface TraefikDeps { sandboxes: () => string[]; links: (name: string) => AppLink[] | null; env: NodeJS.ProcessEnv }
const defaults: TraefikDeps = { sandboxes: () => listSandboxDirs().map(e => e.name), links: rememberedApps, env: process.env }

const NOOP = { headers: { customRequestHeaders: { 'X-P7y-User': '' } } }
const AUTH = { forwardAuth: { address: 'http://p7y:3000/auth/app', trustForwardHeader: true, authResponseHeaders: ['X-P7y-User', 'Cookie'] } }

export function traefikAccessConfig(deps: Partial<TraefikDeps> = {}) {
  const d = { ...defaults, ...deps }
  const middlewares: Record<string, object> = {}
  for (const name of d.sandboxes()) middlewares[`access-${name}`] = sandboxAccess(name, d.links(name), d.env) === 'public' ? NOOP : AUTH
  return { http: { middlewares } }
}

export interface RefreshDeps { running: () => Promise<string[]>; links: (name: string) => Promise<unknown> }
const refreshDefaults: RefreshDeps = {
  running: async () => (await listManagedContainers().catch(() => [])).filter(c => c.status === 'running').map(c => c.name),
  links: name => appLinks(name),
}

/** Reads the running sandboxes' app links (and so their p7y.access) every 10 s: a new label applies within seconds. */
export async function refreshRunningLinks(deps: Partial<RefreshDeps> = {}): Promise<void> {
  const d = { ...refreshDefaults, ...deps }
  for (const name of new Set(await d.running())) await d.links(name).catch(() => {})
}

let timer: NodeJS.Timeout | null = null
export function startAccessRefresher(): void {
  if (timer) return
  timer = setInterval(() => { void refreshRunningLinks() }, 10_000)
  timer.unref()
}
