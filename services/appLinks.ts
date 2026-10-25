import fs from 'fs'
import { innerDocker } from './innerDocker'
import { frpcName, ALL_INTERFACES, type InnerContainer } from './tcpNames'
import { sandboxParent } from './sandboxPaths'
import { rememberLastSeen, lastSeen } from './lastSeen'
import { frpsApiAuth } from './frpsApi'
import { accessOfLabel, type Access } from './appAccess/level'

/** project: its compose project (tells apart services of the same name); access: who opens it (p7y.access, else
 * the default); access_invalid: its label is not a level (so: owner) */
export interface AppLink { url: string; port: number; service: string; project?: string; access: Access; access_invalid?: true }
type AppName = { port: number; service: string; project?: string; access: Access; access_invalid?: true }
export interface AppLinkDeps {
  domains: (name: string) => Promise<string[]>
  containers: (name: string) => Promise<InnerContainer[]>
  instance: (name: string) => string
  now: () => number
  /** Keeps the links a running sandbox answered with, for showing them while it sleeps. */
  remember: (name: string, links: AppLink[]) => void
  /** Keeps every app's level (link name → p7y.access) from the labels, whatever frps serves yet */
  rememberAccess: (name: string, access: AccessMap) => void
  /** The links it last answered with (rememberedApps) */
  recall: (name: string) => AppLink[] | null
}
/** Each app's level by its link name (the first label of its address), from its container's p7y.access */
export type AccessMap = Record<string, Access>

/** Link names (no domain, lowercase) → host port and app name (compose service, else container name),
 * for TCP ports published on all interfaces. A port bound to 127.0.0.1 (or any one address) has no name. */
export function publicAppNames(instance: string, containers: InnerContainer[]): Map<string, AppName> {
  const out = new Map<string, AppName>()
  for (const c of containers) {
    const ports = [...new Set(c.Ports.filter(p => p.Type === 'tcp' && p.PublicPort && ALL_INTERFACES.has(p.IP ?? '')).map(p => p.PublicPort!))].sort((a, b) => a - b)
    const service = c.Labels['com.docker.compose.service'] || (c.Names[0] ?? '').replace(/^\//, '')
    const project = c.Labels['com.docker.compose.project']
    const a = accessOfLabel(c.Labels['p7y.access'])
    for (const port of ports) {
      const name = frpcName(instance, c.Labels, c.Names[0] ?? '', port).toLowerCase()
      if (!out.has(name)) out.set(name, { port, service, ...(project ? { project } : {}), access: a.access, ...(a.invalid ? { access_invalid: true as const } : {}) })
    }
  }
  return out
}

/** The domains frps has HTTP proxies for (what frpc in the sandbox registered); [] if it cannot be asked. */
export async function frpsDomains(name: string): Promise<string[]> {
  return askFrps(name).catch(() => [])
}

/** As frpsDomains, but throws when socat (which passes the API on from frps) does not answer within 3 s. */
async function askFrps(name: string): Promise<string[]> {
  // Its API has a password, in frps.toml
  let auth: string | null = null
  try { auth = frpsApiAuth(fs.readFileSync(`${dirOf(name)}/frps.toml`, 'utf8')) } catch { /* no frps.toml: ask without */ }
  const headers: Record<string, string> = auth ? { authorization: `Basic ${Buffer.from(auth).toString('base64')}` } : {}
  // Only socat: frps is on the sandbox's own network, not Purgatory's, so its name never resolves (and a name that
  // does not resolve costs seconds, holding up every other lookup meanwhile)
  const res = await fetch(`http://${name}-socat:7500/api/proxy/http`, { headers, signal: AbortSignal.timeout(3000) })
  if (!res.ok) throw new Error(`frps of ${name} answered ${res.status}`)
  const data = await res.json() as { proxies?: Array<{ conf?: { customDomains?: string[] } }> }
  return (data.proxies ?? []).flatMap(p => p.conf?.customDomains ?? [])
}

const dirOf = (name: string) => `${sandboxParent(name)}/${name}`

function rememberApps(name: string, links: AppLink[]): void {
  rememberLastSeen(dirOf(name), 'apps', links)
}

const accessMapOf = (allowed: Map<string, { access: Access }>): AccessMap => Object.fromEntries([...allowed].map(([n, v]) => [n, v.access]))

/** Every app's level as last read from the labels; for a sandbox not read since 0.9, from its remembered links. */
export function rememberedAccess(name: string): AccessMap | null {
  const m = lastSeen(dirOf(name), 'access')
  if (m && typeof m === 'object' && !Array.isArray(m)) return m as AccessMap
  const links = rememberedApps(name)
  return links ? Object.fromEntries(links.map(l => [l.url.toLowerCase().split('.')[0], l.access])) : null
}

/** Every app's level now, from the inner Docker's labels (no frps): for an address not known yet. */
export async function freshAccess(name: string, deps: Partial<AppLinkDeps> = {}): Promise<AccessMap | null> {
  const d = { ...defaults, ...deps }
  try {
    const map = accessMapOf(publicAppNames(d.instance(name), await d.containers(name)))
    if (Object.keys(map).length) d.rememberAccess(name, map)
    return map
  } catch { return null }
}

/** The app links a sandbox had when it last ran (null if never seen running since this was added). */
export function rememberedApps(name: string): AppLink[] | null {
  const links = lastSeen(dirOf(name), 'apps')
  // Links remembered before 0.9 have no access: the default
  return Array.isArray(links) ? links.filter((l): l is AppLink => typeof l?.url === 'string').map(l => ({ ...l, access: l.access ?? accessOfLabel(undefined).access })) : null
}

const defaults: AppLinkDeps = {
  domains: askFrps,
  containers: async name => (await innerDocker(name).listContainers()) as unknown as InnerContainer[],
  instance: name => fs.readFileSync(`${sandboxParent(name)}/${name}/instance-name`, 'utf8').trim(),
  now: Date.now,
  remember: rememberApps,
  rememberAccess: (name, access) => rememberLastSeen(dirOf(name), 'access', access),
  recall: name => rememberedApps(name),
}
const TTL_MS = 10_000
const cache = new Map<string, { at: number; links: AppLink[] }>()
// One read per sandbox at a time: callers asking meanwhile (every user's list, the access refresher) share it
const reading = new Map<string, Promise<AppLink[]>>()
// Sandboxes whose frps or inner Docker did not answer the last read, and when: not asked again for 2 s (a page asks
// for the same sandbox's links more than once, and each wait for an answer that does not come takes seconds)
const unreachable = new Map<string, number>()
const RETRY_MS = 2000

/** A running sandbox's app links: what frps serves (or `seen`), only for ports published on all interfaces.
 * Cached 10 s (the UI polls every 5 s); frps or the inner Docker not answering shows no link (closed).
 * The links found are remembered (rememberedApps): a sleeping sandbox shows the apps it last ran. */
export async function appLinks(name: string, deps: Partial<AppLinkDeps> = {}, seen?: string[]): Promise<AppLink[]> {
  const d = { ...defaults, ...deps, ...(seen ? { domains: async () => seen } : {}) }
  // `seen` (createSandbox: the domains it gathered itself) is filtered afresh, not answered from the cache
  if (seen !== undefined) return readLinks(name, d)
  const hit = cache.get(name)
  if (hit && d.now() - hit.at < TTL_MS) return hit.links
  const failed = unreachable.get(name)
  if (failed !== undefined && d.now() - failed < RETRY_MS) return []
  const pending = reading.get(name)
  if (pending) return pending
  const read = readLinks(name, d).finally(() => reading.delete(name))
  reading.set(name, read)
  return read
}

/**
 * For showing a running sandbox's apps: when frps or its inner Docker did not answer (a busy server), the links it
 * last answered with, marked stale, rather than none.
 */
export async function appLinksForView(name: string, deps: Partial<AppLinkDeps> = {}): Promise<{ links: AppLink[]; stale: boolean }> {
  const links = await appLinks(name, deps)
  if (!unreachable.has(name)) return { links, stale: false }
  return { links: ({ ...defaults, ...deps }).recall(name) ?? [], stale: true }
}

async function readLinks(name: string, d: AppLinkDeps): Promise<AppLink[]> {
  let links: AppLink[] = []
  try {
    const [domains, containers] = await Promise.all([d.domains(name), d.containers(name)])
    const allowed = publicAppNames(d.instance(name), containers)
    // Every app's level from the labels, also those frps does not serve yet
    if (allowed.size) d.rememberAccess(name, accessMapOf(allowed))
    for (const url of domains) {
      const hit = allowed.get(url.toLowerCase().split('.')[0])
      if (hit) links.push({ url, ...hit })
    }
    // Not an empty answer: frps has none until frpc registers, right after a wake
    if (links.length) d.remember(name, links)
    unreachable.delete(name)
  } catch { links = []; unreachable.set(name, d.now()) }
  // An empty answer is not kept: right after a create or a wake frps has no proxy yet, and the next ask must see it
  if (links.length) cache.set(name, { at: d.now(), links }); else cache.delete(name)
  return links
}

export function forgetAppLinks(name?: string): void {
  if (name) { cache.delete(name); unreachable.delete(name) } else { cache.clear(); unreachable.clear() }
}
