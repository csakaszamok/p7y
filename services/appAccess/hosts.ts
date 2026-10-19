import { findSandboxDirByHost } from '../wake'
import { listSandboxDirs } from '../sandboxPaths'
import { rememberedAccess, freshAccess, type AccessMap } from '../appLinks'
import { getSandboxState } from '../docker'
import { mostRestrictive, type Access } from './level'
import { indexed } from './index'

export interface HostAccess { sandbox: string; owner: string; access: Access }
export interface HostDeps {
  sandboxOf: (host: string) => string | null
  ownerOf: (name: string) => string
  /** Every app's level by its link name, as last read from the labels (null if never) */
  accessMap: (name: string) => AccessMap | null
  /** The same, read now from the inner Docker (null when it is not running or cannot be asked) */
  fresh: (name: string) => Promise<AccessMap | null>
  env: NodeJS.ProcessEnv
  now: () => number
}

/** A fresh read of a sandbox's labels at most every 2 s: random addresses under a sandbox must not hammer its Docker */
const FRESH_MS = 2_000
const freshAt = new Map<string, number>()

const defaults: HostDeps = {
  sandboxOf: findSandboxDirByHost,
  ownerOf: name => listSandboxDirs().find(e => e.name === name)?.owner ?? 'admin',
  accessMap: rememberedAccess,
  fresh: async name => {
    const now = Date.now()
    if (now - (freshAt.get(name) ?? 0) < FRESH_MS) return null
    freshAt.set(name, now)
    return (await getSandboxState(name).catch(() => null))?.status === 'running' ? freshAccess(name) : null
  },
  env: process.env,
  now: Date.now,
}

/** Every request of a non-public app asks (forwardAuth). Not in the in-memory index (a sandbox just created): looked
 * up from the sandbox's files, then kept a few seconds. */
const CACHE_MS = 3_000
const cache = new Map<string, { at: number; value: HostAccess | null }>()
export function _resetHostCache(): void { cache.clear(); freshAt.clear() }

/** The strictest level of a sandbox's apps; null when none is known (so: not public). */
export function sandboxAccess(map: AccessMap | null): Access | null {
  const levels = Object.values(map ?? {})
  return levels.length ? mostRestrictive(levels) : null
}

/** Who may open this address: its app's level, from the labels; an app not known even after reading them afresh is
 * closed (owner), never given the level of the sandbox's other apps; null for a host that is not a sandbox's. */
export async function accessOfHost(host: string, deps: Partial<HostDeps> = {}): Promise<HostAccess | null> {
  const d = { ...defaults, ...deps }
  const h = host.replace(/:\d+$/, '').toLowerCase()
  // Cached only with the real sources (tests that pass their own get fresh answers)
  const cacheable = !deps.sandboxOf && !deps.accessMap && !deps.fresh && !deps.ownerOf
  if (cacheable) {
    const known = indexed(h)
    if (known !== undefined) return known
  }
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
  const label = h.split('.')[0]
  let access = d.accessMap(sandbox)?.[label]
  if (access === undefined) access = (await d.fresh(sandbox))?.[label]
  return { sandbox, owner: d.ownerOf(sandbox), access: access ?? 'owner' }
}
