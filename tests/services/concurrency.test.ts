import { describe, it, expect } from 'vitest'
import { concurrency } from '../../services/concurrency'

describe('concurrency', () => {
  it('runs at most max at once, the rest in turn, and passes results and failures on', async () => {
    const limit = concurrency(2)
    let now = 0, most = 0
    const order: number[] = []
    const job = (i: number) => limit(async () => {
      now++; most = Math.max(most, now)
      await new Promise(r => setTimeout(r, 5))
      now--; order.push(i)
      if (i === 3) throw new Error('three')
      return i
    })
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map(job))
    expect(most).toBe(2)
    expect(order.sort()).toEqual([1, 2, 3, 4, 5])
    expect(results.map(r => r.status === 'fulfilled' ? r.value : (r.reason as Error).message)).toEqual([1, 2, 'three', 4, 5])
    // Free again: the next one starts at once
    expect(await limit(async () => 'after')).toBe('after')
  })
})
