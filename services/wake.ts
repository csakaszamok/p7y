import fs from 'fs'
import http from 'node:http'
import https from 'node:https'
import { certsPresent } from './tlsConfig'
import { listManagedContainers } from './docker'
import { composeUp, composeStart } from './compose'
import type { WakeRefusal } from './quota'
import { rawNameOf } from './naming'
import { listSandboxDirs, sandboxParent } from './sandboxPaths'

/** Sandboxes being woken, and where from: the waiting page reloads and keeps saying it */
const starting = new Map<string, 'asleep' | 'deep_sleep'>()

/** Whether a deep-sleep wake (compose up) of this sandbox is running right now. */
export function wakeInProgress(name: string): boolean {
  return starting.has(name)
}

function hostDomain(): string {
  return (process.env.HOST_DOMAIN ?? 'lvh.me').toLowerCase()
}

/**
 * Sandbox dir for a host the sandbox router would match (`<raw>-<x>.<HOST_DOMAIN>`,
 * same rule as the template's HostRegexp), longest raw name first. Other hosts
 * would never reach the sandbox after a wake, so they are not woken.
 */
export function findSandboxDirByHost(host: string): string | null {
  const h = host.replace(/:\d+$/, '').toLowerCase()
  const suffix = `.${hostDomain()}`
  if (!h.endsWith(suffix)) return null
  const label = h.slice(0, -suffix.length)
  if (!/^[a-z0-9-]+$/.test(label)) return null
  const matches = listSandboxDirs()
    .filter(e => rawNameOf(e.name) !== null)
    .filter(e => {
      const raw = rawNameOf(e.name)!
      return label.startsWith(`${raw}-`) && label.length > raw.length + 1
    })
    .filter(e => fs.existsSync(`${e.dir}/docker-compose.yml`))
    .map(e => e.name)
    .sort((a, b) => b.length - a.length)
  return matches[0] ?? null
}

// Every p7y waiting page has it (the limit page does not): a request answered by one did not reach the sandbox
const WAKE_PAGE_MARKER = 'data-p7y-waiting'

/**
 * Send one request through Traefik to the sandbox's own router so the Sablier
 * middleware opens a session; otherwise a sandbox woken by a single request would
 * stay up forever. Retries while Traefik still routes the host to our catch-all.
 */
/**
 * GET / on Traefik with a custom Host header (fetch() cannot override Host).
 * With HTTPS on, plain HTTP is redirected before any sandbox router (and its
 * Sablier middleware) sees the request, so go straight to 443 — SNI = host;
 * the certificate is not checked, the peer is our own Traefik on the internal net.
 */
function getViaTraefik(hostHeader: string): Promise<{ status: number; body: string }> {
  return requestViaTraefik(hostHeader, 'GET', '/')
}

/** Any request to a sandbox address through our own Traefik (see getViaTraefik); the body is kept up to 64 KB. */
export function requestViaTraefik(hostHeader: string, method: string, path: string, opts: { body?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; body: string }> {
  const base = new URL(process.env.TRAEFIK_INTERNAL_URL ?? 'http://traefik')
  const headers = { ...opts.headers, host: hostHeader, ...(opts.body !== undefined ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(opts.body)) } : {}) }
  return new Promise((resolve, reject) => {
    const onResponse = (res: http.IncomingMessage) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => { if (body.length < 65_536) body += chunk })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    }
    const req = certsPresent()
      ? https.request({ method, hostname: base.hostname, port: 443, path, servername: hostHeader, rejectUnauthorized: false, headers, timeout: 10_000 }, onResponse)
      : http.request({ method, hostname: base.hostname, port: base.port || 80, path, headers, timeout: 10_000 }, onResponse)
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end(opts.body)
  })
}

/** Opens (or renews) the sandbox's Sablier session; false if it could not within `attempts`. */
export async function primeSablierSession(name: string, attempts = 30, delayMs = 1000): Promise<boolean> {
  const raw = rawNameOf(name) ?? name
  const host = `${raw}-p7y-wake.${hostDomain()}`
  for (let i = 0; i < attempts; i++) {
    try {
      // Through the sandbox router the request passes Sablier (session opened) and
      // then frps, which answers 404 for this made-up host — so only our own
      // catch-all page (router not picked up yet) or a Traefik error means retry.
      const { status, body } = await getViaTraefik(host)
      if (!body.includes(WAKE_PAGE_MARKER) && status !== 502 && status !== 503 && (status < 300 || status >= 400)) return true
    } catch { /* traefik briefly unreachable: retry */ }
    if (i + 1 < attempts) await new Promise<void>(r => setTimeout(r, delayMs))
  }
  // A single try is a keep-alive ping, repeated soon: one miss is not worth a line
  if (attempts > 1) console.error(`[wake] ${name}: could not open a Sablier session; it will not sleep until its next request`)
  return false
}

/** Rebuild a deep-sleeping sandbox in the background; at most one compose up per sandbox at a time. */
/** When a wake's compose up finished, per sandbox. */
const wokenAt = new Map<string, number>()
// From the start of a wake until its router is there: compose up from deep sleep, then socat healthy (up to 2 min)
const ROUTER_GRACE_MS = 180_000

/** A sandbox p7y just started (any path): for a minute its address may still reach us instead of its router. */
export function markWoken(name: string): void { wokenAt.set(name, Date.now()) }

export async function wakeByHost(host: string): Promise<{ result: 'not_found' | 'started' | 'in_progress' | 'outdated' | 'no_route' | 'limit'; name?: string; from?: 'asleep' | 'deep_sleep'; refusal?: WakeRefusal }> {
  const name = findSandboxDirByHost(host)
  if (!name) return { result: 'not_found' }
  // With HTTPS on, a sandbox whose router only listens on `web` can never be
  // reached (every HTTP request is redirected), so waking it would loop forever.
  if (certsPresent() && !fs.readFileSync(`${sandboxParent(name)}/${name}/docker-compose.yml`, 'utf8').includes('websecure')) {
    return { result: 'outdated', name }
  }
  if (starting.has(name)) return { result: 'in_progress', name, from: starting.get(name) }
  const live = (await listManagedContainers()).find(c => c.name === name)
  // p7y's own Sablier session probe (primeSablierSession) must never wake a sandbox someone has just put to sleep
  if (host.toLowerCase().startsWith(`${rawNameOf(name) ?? name}-p7y-wake.`) && live?.status !== 'running') return { result: 'in_progress', name }
  if (live?.status === 'running') {
    // Running, so the request should have hit the sandbox router: right after a wake (any path) Traefik may not
    // have it yet; later, no router matches this address at all
    const woke = wokenAt.get(name)
    return { result: woke !== undefined && Date.now() - woke < ROUTER_GRACE_MS ? 'in_progress' : 'no_route', name }
  }
  // Asleep (its router exists only while it runs) or in deep sleep (no containers): p7y wakes it, within the limits
  const from = live ? 'asleep' as const : 'deep_sleep' as const
  const composePath = `${sandboxParent(name)}/${name}/docker-compose.yml`
  const owner = live?.owner ?? /^\s*(?:p7y|leander)\.owner:\s*["']?([^"'\s]+)["']?\s*$/m.exec(fs.readFileSync(composePath, 'utf8'))?.[1] ?? 'admin'
  const { reserveWake } = await import('./quota')
  const slot = await reserveWake(owner, name, live ? live.status : 'deep_sleep')
  if (!slot.ok) return { result: 'limit', name, refusal: slot.refusal }
  starting.set(name, from)
  markWoken(name)
  ;(live ? composeStart(composePath) : composeUp(composePath))
    .then(async () => {
      // Its containers run now and count as running: the reservation is not needed while the session opens
      slot.release()
      markWoken(name)
      console.log(`[wake] ${name} woken from ${from === 'asleep' ? 'sleep' : 'deep sleep'} by a request`)
      await primeSablierSession(name)
    })
    .catch(err => console.error(`[wake] starting ${name} failed:`, err instanceof Error ? err.message : err))
    .finally(() => { starting.delete(name); slot.release() })
  return { result: 'started', name, from }
}
