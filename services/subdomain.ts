/** Container labels as Docker reports them (a map), or as a compose file may write them (`key=value` list). */
export type Labels = Record<string, string | undefined> | string[] | undefined

/** The label naming an app's address, in order of precedence: `p7y.subdomain`, then the older `frpc.subdomain`. */
export const SUBDOMAIN_LABELS = ['p7y.subdomain', 'frpc.subdomain'] as const

function labelOf(labels: Labels, key: string): string | undefined {
  if (Array.isArray(labels)) {
    const entry = labels.find(l => typeof l === 'string' && l.startsWith(`${key}=`))
    return entry?.slice(key.length + 1)
  }
  return labels?.[key]
}

/**
 * The subdomain an app container asked for (`<sandbox>-<subdomain>.<domain>`), or undefined. Mirrors the foxglove
 * image's frpc template (0.8.0+): a non-empty `p7y.subdomain` wins, else `frpc.subdomain`, still read for older stacks.
 */
export function subdomainOf(labels: Labels): string | undefined {
  for (const key of SUBDOMAIN_LABELS) {
    const v = labelOf(labels, key)
    if (v) return v
  }
  return undefined
}
