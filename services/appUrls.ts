import fs from 'fs'
import yaml from 'js-yaml'
import { rawNameOf } from './naming'

export interface AppHostContext {
  /** The sandbox's raw name (INSTANCE_NAME inside the sandbox). */
  instance: string
  /** The inner compose project name. */
  project: string
  domain: string
}

interface Service {
  container_name?: string
  ports?: unknown[]
  labels?: Record<string, string> | string[]
}

const dash = (s: string) => s.toLowerCase().replace(/[/_]/g, '-')

function label(labels: Service['labels'], key: string): string | undefined {
  if (Array.isArray(labels)) {
    const entry = labels.find(l => typeof l === 'string' && l.startsWith(`${key}=`))
    return entry?.slice(key.length + 1)
  }
  return labels?.[key]
}

const ALL_INTERFACES = new Set(['', '0.0.0.0', '::'])

/** The fixed TCP host port of a `ports:` entry published on all interfaces, or null (container-only, udp,
 * range, or bound to an address such as 127.0.0.1: private to the sandbox). */
function hostPort(entry: unknown): number | null {
  if (typeof entry === 'object' && entry !== null) {
    const { published, protocol, host_ip } = entry as { published?: unknown; protocol?: unknown; host_ip?: unknown }
    if (protocol !== undefined && protocol !== 'tcp') return null
    if (host_ip !== undefined && !ALL_INTERFACES.has(String(host_ip))) return null
    const n = Number(published)
    return published !== undefined && Number.isInteger(n) && n > 0 ? n : null
  }
  if (typeof entry !== 'string' && typeof entry !== 'number') return null
  const [spec, proto = 'tcp'] = String(entry).split('/')
  if (proto !== 'tcp') return null
  // [v6]:host:container, ip:host:container (ip may be an unbracketed v6 such as ::1), host:container
  const v6 = /^\[([^\]]*)\]:(.*)$/.exec(spec)
  const all = spec.split(':')
  const ip = v6 ? v6[1] : all.length >= 3 ? all.slice(0, -2).join(':') : ''
  if (!ALL_INTERFACES.has(ip)) return null
  const parts = (v6 ? v6[2] : spec).split(':')
  if (parts.length < 2) return null
  const host = parts[parts.length - 2]
  return /^[1-9][0-9]*$/.test(host) ? Number(host) : null
}

/**
 * The app hosts frpc will register for an inner compose file. Mirrors the
 * foxglove image's docker-gen template (/etc/frpc/frpc.tmpl): one HTTP proxy
 * per TCP port published on all interfaces, `<instance>-<frpc.subdomain>` when that label is set,
 * else `<instance>-<project>-<container>-port<hostPort>`.
 */
export function appEntriesFromCompose(text: string, ctx: AppHostContext): Array<{ host: string; service: string }> {
  let services: Record<string, Service | null> = {}
  try {
    services = (yaml.load(text) as { services?: Record<string, Service | null> } | null)?.services ?? {}
  } catch {
    return []
  }
  const project = dash(ctx.project)
  const out: Array<{ host: string; service: string }> = []
  for (const [service, def] of Object.entries(services)) {
    if (!def) continue
    const container = dash(def.container_name ?? `${ctx.project}-${service}-1`)
    const subdomain = label(def.labels, 'frpc.subdomain')
    for (const port of (def.ports ?? []).map(hostPort)) {
      if (port === null) continue
      const host = subdomain
        ? `${ctx.instance}-${subdomain}.${ctx.domain}`
        : `${ctx.instance}-${project}-${container}-port${port}.${ctx.domain}`
      if (!out.some(e => e.host === host)) out.push({ host, service })
    }
  }
  return out
}

/** The hosts alone (see appEntriesFromCompose). */
export function appHostsFromCompose(text: string, ctx: AppHostContext): string[] {
  return appEntriesFromCompose(text, ctx).map(e => e.host)
}

/**
 * App hosts of a sandbox that is not running (no frps to ask), from the inner
 * compose file Purgatory deployed. Apps started by other means are not listed.
 */
export function appEntriesOffline(name: string, dir: string, domain: string, innerProject: () => string | undefined): Array<{ host: string; service: string }> {
  let text: string
  try { text = fs.readFileSync(`${dir}/inner/docker-compose.yml`, 'utf8') } catch { return [] }
  let instance = rawNameOf(name) ?? name
  try { instance = fs.readFileSync(`${dir}/instance-name`, 'utf8').trim() || instance } catch { /* older sandbox */ }
  return appEntriesFromCompose(text, { instance, project: innerProject() ?? 'inner', domain })
}

export function appHostsOffline(name: string, dir: string, domain: string, innerProject: () => string | undefined): string[] {
  return appEntriesOffline(name, dir, domain, innerProject).map(e => e.host)
}
