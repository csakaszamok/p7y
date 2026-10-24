/** Runs at most `max` of the functions given to it at once; the others wait their turn, first come first served. */
export function concurrency(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0
  const waiting: Array<() => void> = []
  return async fn => {
    if (active >= max) await new Promise<void>(resolve => waiting.push(resolve))
    else active++
    try { return await fn() } finally {
      const next = waiting.shift()
      if (next) next(); else active--
    }
  }
}
