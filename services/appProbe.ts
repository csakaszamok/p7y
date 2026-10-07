import http from 'http'
import type { AppLink } from './appLinks'

/** Whether something answers HTTP on host:port (any status, a 404 too); refused, silent or not HTTP: false. */
export function probeHttp(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.request({ host, port, path: '/', method: 'GET', headers: { 'User-Agent': 'p7y-probe' } }, res => {
      clearTimeout(timer)
      res.resume()
      resolve(true)
      req.destroy()
    })
    // A deadline for the whole answer: the request's own timeout is per idle period, and an app
    // trickling its headers a byte at a time would never trip it
    const timer = setTimeout(() => { resolve(false); req.destroy() }, timeoutMs)
    req.on('error', () => { clearTimeout(timer); resolve(false) })
    req.end()
  })
}

export interface AppStatus { url: string; port: number | null; service: string | null; answers: boolean | null }
const TTL_MS = 10_000
const cache = new Map<string, { at: number; key: string; apps: AppStatus[] }>()

/** Each link's port probed straight on the sandbox container (the internal network, not Traefik/Sablier:
 * it neither wakes the sandbox nor keeps it awake). Remembered 10 s: the panel asks every 5 s. */
export async function appStatuses(
  name: string, links: AppLink[],
  deps: { probe?: (host: string, port: number) => Promise<boolean>; now?: () => number } = {},
): Promise<AppStatus[]> {
  const probe = deps.probe ?? ((h: string, p: number) => probeHttp(h, p))
  const now = deps.now ?? Date.now
  const key = links.map(l => `${l.url}:${l.port}`).join(',')
  const hit = cache.get(name)
  if (hit && hit.key === key && now() - hit.at < TTL_MS) return hit.apps
  const apps = await Promise.all(links.map(async l => ({ url: l.url, port: l.port, service: l.service, answers: await probe(name, l.port) })))
  cache.set(name, { at: now(), key, apps })
  return apps
}

export function forgetAppStatuses(): void { cache.clear() }
