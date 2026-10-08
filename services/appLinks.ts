import fs from 'fs'
import { innerDocker } from './innerDocker'
import { frpcName, ALL_INTERFACES, type InnerContainer } from './tcpNames'
import { sandboxParent } from './sandboxPaths'
import { writeFileAtomic } from './atomicWrite'

export interface AppLink { url: string; port: number; service: string }
export interface AppLinkDeps {
  domains: (name: string) => Promise<string[]>
  containers: (name: string) => Promise<InnerContainer[]>
  instance: (name: string) => string
  now: () => number
  /** Keeps the links a running sandbox answered with, for showing them while it sleeps. */
  remember: (name: string, links: AppLink[]) => void
}

/** Link names (no domain, lowercase) → host port and app name (compose service, else container name),
 * for TCP ports published on all interfaces. A port bound to 127.0.0.1 (or any one address) has no name. */
export function publicAppNames(instance: string, containers: InnerContainer[]): Map<string, { port: number; service: string }> {
  const out = new Map<string, { port: number; service: string }>()
  for (const c of containers) {
    const ports = [...new Set(c.Ports.filter(p => p.Type === 'tcp' && p.PublicPort && ALL_INTERFACES.has(p.IP ?? '')).map(p => p.PublicPort!))].sort((a, b) => a - b)
    const service = c.Labels['com.docker.compose.service'] || (c.Names[0] ?? '').replace(/^\//, '')
    for (const port of ports) {
      const name = frpcName(instance, c.Labels, c.Names[0] ?? '', port).toLowerCase()
      if (!out.has(name)) out.set(name, { port, service })
    }
  }
  return out
}

/** The domains frps has HTTP proxies for (what frpc in the sandbox registered); [] if it cannot be asked. */
export async function frpsDomains(name: string): Promise<string[]> {
  for (const host of [`${name}-socat`, `${name}-frps`]) {
    try {
      const res = await fetch(`http://${host}:7500/api/proxy/http`)
      if (!res.ok) continue
      const data = await res.json() as { proxies?: Array<{ conf?: { customDomains?: string[] } }> }
      return (data.proxies ?? []).flatMap(p => p.conf?.customDomains ?? [])
    } catch { /* try next */ }
  }
  return []
}

const appsFile = (name: string) => `${sandboxParent(name)}/${name}/apps.json`
const remembered = new Map<string, string>()

function rememberApps(name: string, links: AppLink[]): void {
  const json = JSON.stringify(links)
  if (remembered.get(name) === json) return
  try { writeFileAtomic(appsFile(name), json); remembered.set(name, json) } catch { /* the sandbox's directory is gone */ }
}

/** The app links a sandbox had when it last ran (null if never seen running since this was added). */
export function rememberedApps(name: string): AppLink[] | null {
  try {
    const links = JSON.parse(fs.readFileSync(appsFile(name), 'utf8')) as unknown
    return Array.isArray(links) ? links.filter((l): l is AppLink => typeof l?.url === 'string') : null
  } catch { return null }
}

const defaults: AppLinkDeps = {
  domains: frpsDomains,
  containers: async name => (await innerDocker(name).listContainers()) as unknown as InnerContainer[],
  instance: name => fs.readFileSync(`${sandboxParent(name)}/${name}/instance-name`, 'utf8').trim(),
  now: Date.now,
  remember: rememberApps,
}
const TTL_MS = 10_000
const cache = new Map<string, { at: number; links: AppLink[] }>()

/** A running sandbox's app links: what frps serves (or `seen`), only for ports published on all interfaces.
 * Cached 10 s (the UI polls every 5 s); the inner Docker not answering shows no link (closed).
 * The links found are remembered (rememberedApps): a sleeping sandbox shows the apps it last ran. */
export async function appLinks(name: string, deps: Partial<AppLinkDeps> = {}, seen?: string[]): Promise<AppLink[]> {
  const d = { ...defaults, ...deps, ...(seen ? { domains: async () => seen } : {}) }
  // `seen` (createSandbox: the domains it gathered itself) is filtered afresh, not answered from the cache
  const fresh = seen !== undefined
  const hit = cache.get(name)
  if (!fresh && hit && d.now() - hit.at < TTL_MS) return hit.links
  let links: AppLink[] = []
  try {
    const [domains, containers] = await Promise.all([d.domains(name), d.containers(name)])
    const allowed = publicAppNames(d.instance(name), containers)
    for (const url of domains) {
      const hit = allowed.get(url.toLowerCase().split('.')[0])
      if (hit) links.push({ url, port: hit.port, service: hit.service })
    }
    // Not an empty answer: frps has none until frpc registers, right after a wake (or when it cannot be asked)
    if (links.length) d.remember(name, links)
  } catch { links = [] }
  cache.set(name, { at: d.now(), links })
  return links
}

export function forgetAppLinks(name?: string): void {
  if (name) cache.delete(name); else cache.clear()
}
