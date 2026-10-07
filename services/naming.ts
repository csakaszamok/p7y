/**
 * Purgatory's technical short name is p7y: new sandboxes are `p7y-<raw>` with
 * `p7y.*` labels. Sandboxes created while the project was called Leander keep
 * their `leander-` name and `leander.*` labels and are recognised as well.
 */
const LEGACY = 'leander'
const LABEL_NS = 'p7y'

export function sandboxPrefix(): string {
  return process.env.SANDBOX_PREFIX ?? 'p7y'
}

function prefixes(): string[] {
  return [...new Set([sandboxPrefix(), LEGACY])]
}

export function sandboxName(raw: string): string {
  return `${sandboxPrefix()}-${raw}`
}

/** The raw name (what URLs are built from) of a sandbox name, or null if it has no known prefix. */
export function rawNameOf(name: string): string | null {
  for (const p of prefixes()) {
    if (name.startsWith(`${p}-`) && name.length > p.length + 1) return name.slice(p.length + 1)
  }
  return null
}

export function labelKey(key: string): string {
  return `${LABEL_NS}.${key}`
}

export function readLabel(labels: Record<string, string> | undefined, key: string): string | undefined {
  return labels?.[`${LABEL_NS}.${key}`] ?? labels?.[`${LEGACY}.${key}`]
}

/** Docker label filters for managed sandbox containers (one query each: Docker ANDs label filters). */
export function managedLabelFilters(): string[] {
  return [`${LABEL_NS}.managed=true`, `${LEGACY}.managed=true`]
}
