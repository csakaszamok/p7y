import { findSandboxDirByHost } from '../wake'
import { listSandboxDirs } from '../sandboxPaths'
import { appLinks, rememberedApps, type AppLink } from '../appLinks'
import { getSandboxState } from '../docker'
import { mostRestrictive, type Access } from './level'

export interface HostAccess { sandbox: string; owner: string; access: Access }
export interface HostDeps {
  sandboxOf: (host: string) => string | null
  ownerOf: (name: string) => string
  /** The sandbox's app links: live while it runs (cached 10 s), else as last seen; null if never seen */
  links: (name: string) => Promise<AppLink[] | null>
  env: NodeJS.ProcessEnv
}

const defaults: HostDeps = {
  sandboxOf: findSandboxDirByHost,
  ownerOf: name => listSandboxDirs().find(e => e.name === name)?.owner ?? 'admin',
  links: async name => (await getSandboxState(name).catch(() => null))?.status === 'running'
    ? appLinks(name).catch(() => rememberedApps(name)) : rememberedApps(name),
  env: process.env,
}

export function sandboxAccess(_name: string, links: AppLink[] | null, env: NodeJS.ProcessEnv = process.env): Access {
  return mostRestrictive((links ?? []).map(l => l.access), env)
}

/** Who may open this address: its app's level; a host of the sandbox without a known app: the sandbox's most
 * restrictive (closed); null for a host that is not a sandbox's. */
export async function accessOfHost(host: string, deps: Partial<HostDeps> = {}): Promise<HostAccess | null> {
  const d = { ...defaults, ...deps }
  const h = host.replace(/:\d+$/, '').toLowerCase()
  const sandbox = d.sandboxOf(h)
  if (!sandbox) return null
  const links = await d.links(sandbox)
  const link = links?.find(l => l.url.toLowerCase() === h)
  return { sandbox, owner: d.ownerOf(sandbox), access: link ? link.access : sandboxAccess(sandbox, links, d.env) }
}
