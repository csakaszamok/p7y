import fs from 'node:fs'
import { hubAppsOf, type HubApp } from './apps'
import { rememberLastSeen, lastSeen } from '../lastSeen'
import { nameOf as rememberedNameOf } from './names'
import { innerDocker } from '../innerDocker'
import { sandboxParent } from '../sandboxPaths'
import { sandboxService } from '../sandbox'
import type { SandboxMeta } from '../docker'
import type { InnerContainer } from '../tcpNames'

export interface HubEntry extends HubApp {
  owner: string
  owner_name: string | null
  sandbox: string
  status: 'running' | 'asleep' | 'deep_sleep'
  updated_at: string
}
export interface Remembered { apps: Array<HubApp & { updated_at: string }>; unlinked: string[] }
export interface HubListDeps {
  states(): Promise<SandboxMeta[]>
  containers(name: string): Promise<InnerContainer[]>
  instance(name: string): string
  dir(name: string): string
  now(): number
  nameOf(email: string): string | null
}

const defaults: HubListDeps = {
  states: () => sandboxService.listSandboxStates(),
  containers: async name => (await innerDocker(name).listContainers()) as unknown as InnerContainer[],
  instance: name => fs.readFileSync(`${sandboxParent(name)}/${name}/instance-name`, 'utf8').trim(),
  dir: name => `${sandboxParent(name)}/${name}`,
  now: Date.now,
  nameOf: email => rememberedNameOf(email),
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
async function liveApps(name: string, d: HubListDeps, prev: Remembered | null): Promise<Remembered> {
  const containers = await d.containers(name)
  // No containers yet (right after a wake): keep what was remembered, the apps are coming back
  if (!containers.length) return prev ?? { apps: [], unlinked: [] }
  const https = (process.env.PUBLIC_URL ?? '').startsWith('https://')
  const { apps, unlinked } = hubAppsOf(d.instance(name), containers, (process.env.HOST_DOMAIN ?? 'lvh.me').toLowerCase(), https ? 'https' : 'http')
  const now = new Date(d.now()).toISOString()
  const merged = apps.map(a => {
    const old = prev?.apps.find(p => p.id === a.id)
    return { ...a, updated_at: old && old.title === a.title && old.description === a.description ? old.updated_at : now }
  })
  const next = { apps: merged, unlinked }
  rememberLastSeen(d.dir(name), 'hub', next)
  return next
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
    return (r?.apps ?? []).map(a => ({ ...a, owner: s.owner, owner_name: d.nameOf(s.owner), sandbox: s.name, status: statusOf(s.status) }))
  }))
  const entries = perSandbox.flat().sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  cache = { at: d.now(), entries }
  return entries
}
