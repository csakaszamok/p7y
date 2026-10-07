const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** "30s" | "15m" | "2h" | "7d" → milliseconds; null for "off" or anything invalid. */
export function parseDuration(value: unknown, allowed = 'smhd'): number | null {
  if (typeof value !== 'string') return null
  const m = /^([1-9][0-9]*)([smhd])$/.exec(value)
  if (!m || !allowed.includes(m[2])) return null
  return Number(m[1]) * UNIT_MS[m[2]]
}
