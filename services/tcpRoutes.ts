import net from 'node:net'
import { publicTcpPorts, type TcpPort } from './tcpNames'
import { findSandboxDirByHost, wakeInProgress } from './wake'
import { getSandboxState } from './docker'
import { sandboxService } from './sandbox'
import type { Target } from './tcpGateway'
import { sandboxHasSsh } from './sandboxSsh'
import { rawNameOf } from './naming'
import { dockerAccessState } from './dockerAccess'

// A sandbox that started less than this long ago may not have its inner containers up yet:
// a missing port then means "wait", not "no such address".
const STARTUP_GRACE_MS = 90_000
const PORTS_CACHE_MS = 1000

/** When "asleep, not woken" was last logged per sandbox: a client that reconnects in a loop logs once in a while. */
const asleepLogged = new Map<string, number>()
/** One wake per sandbox, however many connections ask for it at once. */
const waking = new Map<string, Promise<void>>()
/** The inner Docker's answer per sandbox, shared by connections arriving together. */
const portsCache = new Map<string, { at: number; ports: Promise<TcpPort[]> }>()

export function _resetTcpRoutes(): void { waking.clear(); portsCache.clear(); asleepLogged.clear() }

function wake(sandbox: string): Promise<void> {
  let p = waking.get(sandbox)
  if (!p) {
    // startSandbox also opens the Sablier session, so it sleeps again without HTTP traffic
    p = sandboxService.startSandbox(sandbox)
      .finally(() => waking.delete(sandbox))
    waking.set(sandbox, p)
  }
  return p
}

function portsOf(sandbox: string): Promise<TcpPort[]> {
  const hit = portsCache.get(sandbox)
  if (hit && Date.now() - hit.at < PORTS_CACHE_MS) return hit.ports
  const ports = publicTcpPorts(sandbox)
  ports.catch(() => portsCache.delete(sandbox))
  portsCache.set(sandbox, { at: Date.now(), ports })
  return ports
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>(r => {
  const t = setTimeout(r, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); r() }, { once: true })
})
const canConnect = (host: string, port: number) => new Promise<boolean>(resolve => {
  const s = net.connect(port, host)
  s.once('connect', () => { s.destroy(); resolve(true) })
  s.once('error', () => resolve(false))
  s.setTimeout(2000, () => { s.destroy(); resolve(false) })
})

/**
 * `<http-name>-tcp.<domain>` → the sandbox container and published port. Wakes a sandbox
 * that is not running (once, however many connections ask; and opens its Sablier session,
 * so it sleeps again without HTTP traffic), then waits until the port answers, at most
 * `deadlineMs`, or until `signal` says the client has gone.
 */
export async function resolveTcpHost(sni: string, opts: { deadlineMs?: number; retryMs?: number; host?: string; signal?: AbortSignal; sshPort?: number } = {}): Promise<Target | null> {
  const domain = (process.env.HOST_DOMAIN ?? 'lvh.me').toLowerCase()
  const name = sni.toLowerCase()
  const suffix = `-tcp.${domain}`
  if (!name.endsWith(suffix)) return null
  const sandbox = findSandboxDirByHost(`${name.slice(0, -suffix.length)}.${domain}`)
  if (!sandbox) return null
  // <raw>-shell-tcp: the sandbox container's own sshd (port 22), only on sandboxes created with SSH
  const shell = name === `${rawNameOf(sandbox) ?? sandbox}-shell-tcp.${domain}`
  if (shell && !sandboxHasSsh(sandbox)) return null

  const state = await getSandboxState(sandbox)
  const running = state?.status === 'running'
  if (!running && !wakeInProgress(sandbox)) {
    try { await wake(sandbox) } catch (err) {
      // At the owner's limit (or a failed start): nothing to wait for
      console.log(`[tcp] ${sandbox} not woken: ${err instanceof Error ? err.message : err}`)
      return null
    }
  }
  const startedAt = running && state?.startedAt ? Date.parse(state.startedAt) : NaN
  // Only a sandbox that was already up (and settled) can say "no such port" at once
  const settled = running && !waking.has(sandbox) && !(Date.now() - startedAt < STARTUP_GRACE_MS)

  const deadline = Date.now() + (opts.deadlineMs ?? 60_000)
  const connectHost = opts.host ?? sandbox // the sandbox (DinD) container on traefik-net
  while (Date.now() < deadline && !opts.signal?.aborted) {
    if (shell) {
      const port = opts.sshPort ?? 22
      if (await canConnect(connectHost, port)) return { host: connectHost, port }
      await sleep(opts.retryMs ?? 1000, opts.signal)
      continue
    }
    const ports = await portsOf(sandbox).catch(() => null)
    const port = ports?.find(p => p.host === name)?.port
    // e.g. a port published on 127.0.0.1 only: say so now instead of waiting out the deadline
    if (ports && port === undefined && settled) return null
    if (port !== undefined && await canConnect(connectHost, port)) return { host: connectHost, port }
    await sleep(opts.retryMs ?? 1000, opts.signal)
  }
  return null
}

/**
 * `<raw>-docker.<domain>` → the sandbox's dockerd (TLS passed through), waking the sandbox; null for an
 * unknown sandbox or one whose certificate does not carry the name yet (Enable first).
 */
export async function resolveDockerHost(sni: string, opts: { signal?: AbortSignal; deadlineMs?: number; host?: string; port?: number } = {}): Promise<Target | null> {
  const domain = (process.env.HOST_DOMAIN ?? 'lvh.me').toLowerCase()
  const name = sni.toLowerCase()
  const suffix = `-docker.${domain}`
  if (!name.endsWith(suffix)) return null
  const sandbox = findSandboxDirByHost(name)
  // Exactly <raw>-docker: not a longer label that only starts with another sandbox's name
  if (!sandbox || `${rawNameOf(sandbox) ?? sandbox}${suffix}` !== name) return null
  if (dockerAccessState(sandbox) !== 'ready') return null
  const state = await getSandboxState(sandbox)
  // A Docker connection does not wake a sleeping sandbox: Docker Desktop keeps every context connected and
  // reconnects at once, which woke the sandbox again each time it fell asleep. Wake it first (UI, API, an app).
  if (state?.status !== 'running' && !wakeInProgress(sandbox)) {
    const last = asleepLogged.get(sandbox) ?? 0
    if (Date.now() - last > 10 * 60_000) {
      asleepLogged.set(sandbox, Date.now())
      console.log(`[tcp] ${sandbox} is asleep: a Docker connection does not wake it (wake it first)`)
    }
    return null
  }
  const host = opts.host ?? sandbox, port = opts.port ?? 2376
  const deadline = Date.now() + (opts.deadlineMs ?? 60_000)
  while (Date.now() < deadline && !opts.signal?.aborted) {
    if (await canConnect(host, port)) return { host, port }
    await sleep(1000, opts.signal)
  }
  return null
}
