import { frpcName, ALL_INTERFACES, type InnerContainer } from '../tcpNames'

/** An app a builder published with `p7y.publish: "true"` on its container. id: its web address (host);
 * port: its port published in the sandbox (how Purgatory reaches it without waking anything); image: p7y.image. */
export interface HubApp { id: string; url: string; title: string; description: string; service: string; port: number; image: string | null }

/** A path inside the app ("/shot.png"), never another site: Purgatory fetches it, so a URL would let a label steer it. */
export function appImagePath(label: string | undefined): string | null {
  const v = label?.trim()
  return v && v.startsWith('/') && !v.startsWith('//') && !/[\\\s]/.test(v) ? v : null
}

const MAX_TITLE = 80
const MAX_DESCRIPTION = 280
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * The published apps of one sandbox, from its inner containers' labels. The address is the one the Apps tab shows
 * (foxglove's frpc names, the lowest port published on all interfaces); a published container with no such port
 * has no web address and is listed in `unlinked` instead.
 */
export function hubAppsOf(instance: string, containers: InnerContainer[], domain: string, scheme: 'http' | 'https'): { apps: HubApp[]; unlinked: string[]; badImage: string[] } {
  const apps: HubApp[] = []
  const unlinked: string[] = []
  // Published with a p7y.image that is not a path inside the app (a URL, say): ignored, and said on the Apps tab
  const badImage: string[] = []
  const seen = new Set<string>()
  for (const ct of containers) {
    if (ct.Labels['p7y.publish'] !== 'true') continue
    const service = ct.Labels['com.docker.compose.service'] || (ct.Names[0] ?? '').replace(/^\//, '')
    if (ct.Labels['p7y.image']?.trim() && !appImagePath(ct.Labels['p7y.image'])) badImage.push(service)
    const ports = [...new Set(ct.Ports.filter(p => p.Type === 'tcp' && p.PublicPort && ALL_INTERFACES.has(p.IP ?? '')).map(p => p.PublicPort!))].sort((a, b) => a - b)
    if (!ports.length) { unlinked.push(service); continue }
    const name = frpcName(instance, ct.Labels, ct.Names[0] ?? '', ports[0]).toLowerCase()
    // One DNS label under the domain, nothing else: a label like frpc.subdomain "x@evil.com/" must not steer Open
    if (!DNS_LABEL.test(name)) { unlinked.push(service); continue }
    const id = `${name}.${domain}`
    if (seen.has(id)) continue
    seen.add(id)
    apps.push({
      id,
      url: `${scheme}://${id}`,
      title: (ct.Labels['p7y.title']?.trim() || service).slice(0, MAX_TITLE),
      description: (ct.Labels['p7y.description']?.trim() ?? '').slice(0, MAX_DESCRIPTION),
      service,
      port: ports[0],
      image: appImagePath(ct.Labels['p7y.image']),
    })
  }
  return { apps, unlinked, badImage }
}
