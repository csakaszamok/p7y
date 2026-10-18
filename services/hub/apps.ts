import { frpcName, ALL_INTERFACES, type InnerContainer } from '../tcpNames'

/** An app a builder published with `p7y.publish: "true"` on its container. id: its web address (host). */
export interface HubApp { id: string; url: string; title: string; description: string; service: string }

const MAX_TITLE = 80
const MAX_DESCRIPTION = 280

/**
 * The published apps of one sandbox, from its inner containers' labels. The address is the one the Apps tab shows
 * (foxglove's frpc names, the lowest port published on all interfaces); a published container with no such port
 * has no web address and is listed in `unlinked` instead.
 */
export function hubAppsOf(instance: string, containers: InnerContainer[], domain: string, scheme: 'http' | 'https'): { apps: HubApp[]; unlinked: string[] } {
  const apps: HubApp[] = []
  const unlinked: string[] = []
  const seen = new Set<string>()
  for (const ct of containers) {
    if (ct.Labels['p7y.publish'] !== 'true') continue
    const service = ct.Labels['com.docker.compose.service'] || (ct.Names[0] ?? '').replace(/^\//, '')
    const ports = [...new Set(ct.Ports.filter(p => p.Type === 'tcp' && p.PublicPort && ALL_INTERFACES.has(p.IP ?? '')).map(p => p.PublicPort!))].sort((a, b) => a - b)
    if (!ports.length) { unlinked.push(service); continue }
    const id = `${frpcName(instance, ct.Labels, ct.Names[0] ?? '', ports[0]).toLowerCase()}.${domain}`
    if (seen.has(id)) continue
    seen.add(id)
    apps.push({
      id,
      url: `${scheme}://${id}`,
      title: (ct.Labels['p7y.title']?.trim() || service).slice(0, MAX_TITLE),
      description: (ct.Labels['p7y.description']?.trim() ?? '').slice(0, MAX_DESCRIPTION),
      service,
    })
  }
  return { apps, unlinked }
}
