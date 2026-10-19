import { findSandboxDirByHost } from '../wake'
import { listSandboxDirs } from '../sandboxPaths'
import { appLinks, rememberedApps, type AppLink } from '../appLinks'
import { getSandboxState } from '../docker'
import { mostRestrictive, type Access } from './level'

export interface HostAccess { sandbox: string; owner: string; access: Access }
export interface HostDeps {
  sandboxOf: (host: string) => string | null
  ownerOf: (name: string) => string
  /** The sandbox's live app links while it runs (cached 10 s; [] when frps or the inner Docker cannot say), else null */
  links: (name: string) => Promise<AppLink[] | null>
  /** The links it had when it last ran (null if never seen) */
  remembered: (name: string) => AppLink[] | null
  env: NodeJS.ProcessEnv
  now: () => number
}

const defaults: HostDeps = {
  sandboxOf: findSandboxDirByHost,
  ownerOf: name => listSandboxDirs().find(e => e.name === name)?.owner ?? 'admin',
  links: async name => (await getSandboxState(name).catch(() => null))?.status === 'running' ? appLinks(name).catch(() => null) : null,
  remembered: rememberedApps,
  env: process.env,
  now: Date.now,
}

/** Every request of a non-public app asks (forwardAuth): without this, each would read the sandbox directories twice,
 * ask Docker for its state and read apps.json. A few seconds behind is fine: labels apply within ~12 s anyway. */
const CACHE_MS = 3_000
const cache = new Map<string, { at: number; value: HostAccess | null }>()
export function _resetHostCache(): void { cache.clear() }

export function sandboxAccess(_name: string, links: AppLink[] | null, env: NodeJS.ProcessEnv = process.env): Access {
  return mostRestrictive((links ?? []).map(l => l.access), env)
}

/** Who may open this address: its app's level; a host of the sandbox without a known app: the sandbox's most
 * restrictive (closed); null for a host that is not a sandbox's. */
export async function accessOfHost(host: string, deps: Partial<HostDeps> = {}): Promise<HostAccess | null> {
  const d = { ...defaults, ...deps }
  const h = host.replace(/:\d+$/, '').toLowerCase()
  // Cached only with the real sources (tests that pass their own get fresh answers)
  const cacheable = !deps.sandboxOf && !deps.links && !deps.remembered && !deps.ownerOf
  const hit = cacheable ? cache.get(h) : undefined
  if (hit && d.now() - hit.at < CACHE_MS) return hit.value
  const value = await lookUp(h, d)
  if (cacheable) {
    if (cache.size > 5000) cache.clear()
    cache.set(h, { at: d.now(), value })
  }
  return value
}

async function lookUp(h: string, d: HostDeps): Promise<HostAccess | null> {
  const sandbox = d.sandboxOf(h)
  if (!sandbox) return null
  const live = await d.links(sandbox)
  const remembered = d.remembered(sandbox)
  // An empty live answer is not "no apps": right after a wake frps has none, and a failing inner Docker gives none
  const known = live?.length ? live : remembered
  const link = known?.find(l => l.url.toLowerCase() === h)
  // A host not among them: the strictest of everything known (closed, never open because an answer was empty)
  const access = link ? link.access : sandboxAccess(sandbox, [...(live ?? []), ...(remembered ?? [])], d.env)
  return { sandbox, owner: d.ownerOf(sandbox), access }
}
