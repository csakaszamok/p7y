import { listSandboxDirs } from '../sandboxPaths'
import { rememberedAccess, appLinks, forgetAppLinks, type AppLink, type AccessMap } from '../appLinks'
import { listManagedContainers } from '../docker'
import { sandboxAccess } from './hosts'
import { rebuildIndex } from './index'

/**
 * What Traefik's HTTP provider reads every 2 s: access-<name> for every sandbox, used by its router before Sablier.
 * All its apps public: a no-op (it only removes a client-sent X-P9m-User), so the apps do not depend on Purgatorium;
 * otherwise a forwardAuth to /auth/app. Every known sandbox has one: a router referencing a missing one is disabled.
 */
export interface TraefikDeps { sandboxes: () => string[]; access: (name: string) => AccessMap | null }
const defaults: TraefikDeps = { sandboxes: () => listSandboxDirs().map(e => e.name), access: rememberedAccess }

const NOOP = { headers: { customRequestHeaders: { 'X-P9m-User': '' } } }
const AUTH = { forwardAuth: { address: 'http://p9m-internal:3001/auth/app', trustForwardHeader: true, authResponseHeaders: ['X-P9m-User', 'Cookie'] } }

export function traefikAccessConfig(deps: Partial<TraefikDeps> = {}) {
  const d = { ...defaults, ...deps }
  const middlewares: Record<string, object> = {}
  // From the labels of every app (not only those frps serves yet); none known (just created): forwardAuth, never open
  for (const name of d.sandboxes()) middlewares[`access-${name}`] = sandboxAccess(d.access(name)) === 'public' ? NOOP : AUTH
  return { http: { middlewares } }
}

export interface RefreshDeps { running: () => Promise<string[]>; links: (name: string) => Promise<unknown> }
const refreshDefaults: RefreshDeps = {
  running: async () => (await listManagedContainers().catch(() => [])).filter(c => c.status === 'running').map(c => c.name),
  // Afresh, past appLinks' 10 s cache: a new label applies within one round, not two
  links: name => { forgetAppLinks(name); return appLinks(name) },
}

/** Reads the running sandboxes' app links (and so their p9m.access) every 10 s: a new label applies within seconds. */
export async function refreshRunningLinks(deps: Partial<RefreshDeps> = {}): Promise<Map<string, AppLink[]>> {
  const d = { ...refreshDefaults, ...deps }
  const live = new Map<string, AppLink[]>()
  for (const name of new Set(await d.running())) {
    const links = await d.links(name).catch(() => null)
    if (Array.isArray(links)) live.set(name, links as AppLink[])
  }
  return live
}

/** One round: the running sandboxes' labels, then the in-memory index forwardAuth answers from. */
async function refreshAccess(): Promise<void> {
  // Reading the links also remembers every app's level from the labels (appLinks)
  await refreshRunningLinks()
  rebuildIndex({ sandboxes: listSandboxDirs().map(e => ({ name: e.name, owner: e.owner })), accessOf: rememberedAccess, env: process.env })
}

let timer: NodeJS.Timeout | null = null
export function startAccessRefresher(): void {
  if (timer) return
  // One round at a time: on a busy server a round can take longer than 10 s, and rounds piling up make it busier
  let busy = false
  const round = () => {
    if (busy) return
    busy = true
    refreshAccess().catch(err => console.error('[access]', err)).finally(() => { busy = false })
  }
  round()
  timer = setInterval(round, 10_000)
  timer.unref()
}
