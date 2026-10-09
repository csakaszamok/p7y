/**
 * After a create: wait until frps serves the new sandbox's apps, to return their links. Done as soon as every
 * app the inner compose publishes is there; otherwise when the answer has not changed for `stableMs`
 * (frpc may name an app differently), and at most `deadlineMs`. A failed poll (no answer) keeps what was seen.
 * Counted in rounds, not by the clock, so tests can run it on fake timers.
 */
export async function waitForTunnels(
  poll: () => Promise<string[]>,
  expected: string[],
  opts: { intervalMs?: number; stableMs?: number; deadlineMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<string[]> {
  const { intervalMs = 500, stableMs = 2000, deadlineMs = 30_000 } = opts
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  // Nothing published on all interfaces: no link to wait for
  if (!expected.length) return []
  const want = expected.map(h => h.toLowerCase())
  const key = (hosts: string[]) => hosts.map(h => h.toLowerCase()).sort().join(' ')
  let seen: string[] = []
  let stableRounds = 0
  for (let round = 0; round * intervalMs < deadlineMs; round++) {
    await sleep(intervalMs)
    const fresh = await poll()
    if (fresh.length && key(fresh) !== key(seen)) { seen = fresh; stableRounds = 0 } else if (seen.length) stableRounds++
    const have = new Set(seen.map(h => h.toLowerCase()))
    if (want.every(h => have.has(h))) return seen
    if (seen.length && stableRounds * intervalMs >= stableMs) return seen
  }
  return seen
}
