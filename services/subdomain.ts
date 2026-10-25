/** Container labels as Docker reports them (a map), or as a compose file may write them (`key=value` list). */
export type Labels = Record<string, string | undefined> | string[] | undefined

/** The label naming an app's address. */
export const SUBDOMAIN_LABEL = 'p9m.subdomain'

function labelOf(labels: Labels, key: string): string | undefined {
  if (Array.isArray(labels)) {
    const entry = labels.find(l => typeof l === 'string' && l.startsWith(`${key}=`))
    return entry?.slice(key.length + 1)
  }
  return labels?.[key]
}

/**
 * The subdomain an app container asked for (`<sandbox>-<subdomain>.<domain>`), or undefined. Mirrors the foxglove
 * image's frpc template (0.9.0+): a non-empty `p9m.subdomain`.
 */
export function subdomainOf(labels: Labels): string | undefined {
  return labelOf(labels, SUBDOMAIN_LABEL) || undefined
}
