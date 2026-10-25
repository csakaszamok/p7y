import fs from 'node:fs'
import { hubAppsOf, type HubApp } from './apps'
import { rememberLastSeen, lastSeen } from '../lastSeen'
import { nameOf as rememberedNameOf } from './names'
import { innerDocker } from '../innerDocker'
import { sandboxParent } from '../sandboxPaths'
import { sandboxService } from '../sandbox'
import type { SandboxMeta } from '../docker'
import type { InnerContainer } from '../tcpNames'
import { lastRunningOf, type LastRunning } from '../lastRunning'

export interface HubEntry extends HubApp {
  owner: string
  owner_name: string | null
  sandbox: string
  status: 'running' | 'asleep' | 'deep_sleep'
  updated_at: string
  /** Not running: when its sandbox last ran (estimated: from what it last showed), else null */
  last_ran_at: string | null
  last_ran_estimated: boolean
}
export interface Remembered {
  apps: Array<HubApp & { updated_at: string }>
  unlinked: string[]
  /** Published services whose p9m.image is not a path inside the app */
  bad_image?: string[]
  owner_only?: string[]
  /** Every app ever seen here, kept when it is missing: one that comes back keeps its date (not "new" again) */
  seen?: Record<string, { updated_at: string; title: string; description: string }>
  /** Since when the running sandbox's daemon has listed no containers */
  empty_since?: string
}
export interface HubListDeps {
  states(): Promise<SandboxMeta[]>
  containers(name: string): Promise<InnerContainer[]>
  instance(name: string): string
  dir(name: string): string
  now(): number
  nameOf(email: string): string | null
  lastRan(name: string, status: string): Promise<LastRunning>
}

const defaults: HubListDeps = {
  states: () => sandboxService.listSandboxStates(),
  containers: async name => (await innerDocker(name).listContainers()) as unknown as InnerContainer[],
  instance: name => fs.readFileSync(`${sandboxParent(name)}/${name}/instance-name`, 'utf8').trim(),
  dir: name => `${sandboxParent(name)}/${name}`,
  now: Date.now,
  nameOf: email => rememberedNameOf(email),
  lastRan: (name, status) => lastRunningOf(name, status),
}

const TTL_MS = 30_000
let cache: { at: number; entries: HubEntry[] } | null = null
export function forgetHubList(): void { cache = null }

const statusOf = (s: string): HubEntry['status'] => (s === 'running' ? 'running' : s === 'deep_sleep' ? 'deep_sleep' : 'asleep')

function asRemembered(v: unknown): Remembered | null {
  const r = v as Remembered | null
  return r && Array.isArray(r.apps) && Array.isArray(r.unlinked) ? r : null
}

export function rememberedHub(name: string, dir = defaults.dir(name)): Remembered | null {
  return asRemembered(lastSeen(dir, 'hub'))
}

/** A running sandbox's published apps, read live; updated_at kept unless the title or description changed. */
/** How long a running sandbox may list no containers before its apps leave the Hub: a wake, not a compose down. */
const EMPTY_GRACE_MS = 120_000

async function liveApps(name: string, d: HubListDeps, prev: Remembered | null): Promise<Remembered> {
  const containers = await d.containers(name)
  if (!containers.length) {
    // Right after a wake the apps are coming back: keep them a while; still none after that (compose down): gone
    if (!prev?.apps.length) return prev ?? { apps: [], unlinked: [] }
    const since = prev.empty_since ?? new Date(d.now()).toISOString()
    if (d.now() - Date.parse(since) < EMPTY_GRACE_MS) {
      const kept = { ...prev, empty_since: since }
      rememberLastSeen(d.dir(name), 'hub', kept)
      return kept
    }
    const gone = { apps: [], unlinked: [], seen: prev.seen }
    rememberLastSeen(d.dir(name), 'hub', gone)
    return gone
  }
  const https = (process.env.PUBLIC_URL ?? '').startsWith('https://')
  const { apps, unlinked, badImage, ownerOnly } = hubAppsOf(d.instance(name), containers, (process.env.HOST_DOMAIN ?? 'lvh.me').toLowerCase(), https ? 'https' : 'http')
  const now = new Date(d.now()).toISOString()
  const seen = { ...(prev?.seen ?? Object.fromEntries((prev?.apps ?? []).map(a => [a.id, { updated_at: a.updated_at, title: a.title, description: a.description }]))) }
  const merged = apps.map(a => {
    const old = seen[a.id]
    const updated_at = old && old.title === a.title && old.description === a.description ? old.updated_at : now
    seen[a.id] = { updated_at, title: a.title, description: a.description }
    return { ...a, updated_at }
  })
  const next = { apps: merged, unlinked, bad_image: badImage, owner_only: ownerOnly, seen }
  rememberLastSeen(d.dir(name), 'hub', next)
  return next
}

/** One running sandbox's published apps, read live now and remembered (its Apps tab: right without anyone opening the Hub). */
export async function refreshHub(name: string, deps: Partial<HubListDeps> = {}): Promise<Remembered> {
  const d = { ...defaults, ...deps }
  return liveApps(name, d, asRemembered(lastSeen(d.dir(name), 'hub')))
}

/** Every published app of every sandbox (archived ones are not listed), newest first. Cached 30 s. */
export async function hubEntries(deps: Partial<HubListDeps> = {}): Promise<HubEntry[]> {
  const d = { ...defaults, ...deps }
  if (cache && d.now() - cache.at < TTL_MS) return cache.entries
  const states = await d.states()
  const perSandbox = await Promise.all(states.map(async s => {
    const prev = asRemembered(lastSeen(d.dir(s.name), 'hub'))
    let r: Remembered | null = prev
    if (s.status === 'running') {
      try { r = await liveApps(s.name, d, prev) } catch { r = prev } // its daemon does not answer: what it last showed
    }
    const apps = r?.apps ?? []
    // Asked only for a sandbox that is not running and has apps here (its container's state is read)
    const last = apps.length && s.status !== 'running' ? await d.lastRan(s.name, s.status).catch(() => null) : null
    return apps.map(a => ({ ...a, owner: s.owner, owner_name: d.nameOf(s.owner), sandbox: s.name, status: statusOf(s.status), last_ran_at: last?.at ?? null, last_ran_estimated: last?.estimated ?? false }))
  }))
  const entries = perSandbox.flat().sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  cache = { at: d.now(), entries }
  return entries
}
