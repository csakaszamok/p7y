/** Where a compose volume entry mounts: `source:target[:mode]`, or the long syntax's target (a host mount). */
export function volumeTarget(v: unknown): string | undefined {
  if (typeof v === 'string') return v.split(':')[1]
  const t = (v as { target?: unknown } | null)?.target
  return typeof t === 'string' ? t : undefined
}

/** `du` binds: every volume of a sandbox under /d (disk usage). */
export function measureBinds(volumes: string[]): string[] {
  return volumes.map(v => `${v}:/d/${v}:ro`)
}
