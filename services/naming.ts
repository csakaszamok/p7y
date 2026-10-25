/**
 * Purgatorium's technical short name is p9m: sandboxes are `p9m-<raw>` with `p9m.*` labels.
 */
const LABEL_NS = 'p9m'

export function sandboxPrefix(): string {
  return process.env.SANDBOX_PREFIX ?? 'p9m'
}

export function sandboxName(raw: string): string {
  return `${sandboxPrefix()}-${raw}`
}

/** The raw name (what URLs are built from) of a sandbox name, or null if it has no known prefix. */
export function rawNameOf(name: string): string | null {
  const p = sandboxPrefix()
  return name.startsWith(`${p}-`) && name.length > p.length + 1 ? name.slice(p.length + 1) : null
}

export function labelKey(key: string): string {
  return `${LABEL_NS}.${key}`
}

export function readLabel(labels: Record<string, string> | undefined, key: string): string | undefined {
  return labels?.[`${LABEL_NS}.${key}`]
}

/** Docker label filters for managed sandbox containers (one query each: Docker ANDs label filters). */
export function managedLabelFilters(): string[] {
  return [`${LABEL_NS}.managed=true`]
}
