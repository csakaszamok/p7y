// Whether the app behind a sandbox address answers yet. A woken sandbox's router shows up once any of its tunnels
// is online, and frps answers 404 for an app whose port does not answer yet (Redmine takes a minute): the waiting
// page asks this before it opens the address, so it does not open onto that 404.
import type { AppLink } from './appLinks'

export interface AppReadyDeps {
  find: (host: string) => string | null | Promise<string | null>
  running: (name: string) => Promise<boolean>
  links: (name: string) => Promise<AppLink[]>
  remembered: (name: string) => AppLink[] | null | Promise<AppLink[] | null>
  probe: (name: string, port: number) => Promise<boolean>
}

/** ready: its port answers; false: not yet; null: not an app address known to Purgatory (open it as it is). */
export async function appReady(host: string, deps: AppReadyDeps = defaults()): Promise<{ ready: boolean | null; service?: string }> {
  const h = host.toLowerCase().replace(/:\d+$/, '')
  const name = await deps.find(h)
  if (!name) return { ready: null }
  const now = await deps.running(name) ? await deps.links(name) : []
  const link = now.find(l => l.url.toLowerCase() === h)
  if (link) return { ready: await deps.probe(name, link.port), service: link.service }
  // Not registered (yet): an app the sandbox had when it last ran is still starting
  const before = ((await deps.remembered(name)) ?? []).find(l => l.url.toLowerCase() === h)
  return before ? { ready: false, service: before.service } : { ready: null }
}

function defaults(): AppReadyDeps {
  return {
    find: async host => (await import('./wake')).findSandboxDirByHost(host),
    running: async name => (await (await import('./docker')).listManagedContainers()).some(c => c.name === name && c.status === 'running'),
    links: async name => (await import('./appLinks')).appLinks(name),
    remembered: async name => (await import('./appLinks')).rememberedApps(name),
    probe: async (name, port) => (await import('./appProbe')).probeHttp(name, port),
  }
}
