import { appsDomain } from '../domains'
import type { AccessMap } from '../appLinks'
import type { HostAccess } from './hosts'

/**
 * Every app address's level and owner, in memory: forwardAuth asks for every request of a non-public app (each script
 * and image), and must not read the disk or ask Docker for it. Rebuilt in the background every 10 s from the levels
 * the labels give; an address not in it (a sandbox just created, an app just added) is looked up the slow way.
 */
export interface IndexDeps {
  sandboxes: Array<{ name: string; owner: string }>
  /** Every app's level by its link name, as last read from the labels */
  accessOf: (name: string) => AccessMap | null
  env: NodeJS.ProcessEnv
}

let labels = new Map<string, HostAccess>()
let domain = ''

export function rebuildIndex(d: IndexDeps): void {
  const next = new Map<string, HostAccess>()
  for (const { name, owner } of d.sandboxes) {
    for (const [label, access] of Object.entries(d.accessOf(name) ?? {})) next.set(label.toLowerCase(), { sandbox: name, owner, access })
  }
  labels = next
  domain = appsDomain(d.env)
}

/** From memory: the address's access, or undefined when the index does not know it. */
export function indexed(host: string): HostAccess | undefined {
  if (!domain || !host.endsWith(`.${domain}`)) return undefined
  return labels.get(host.slice(0, -(domain.length + 1)))
}

export function _resetIndex(): void { labels = new Map(); domain = '' }
