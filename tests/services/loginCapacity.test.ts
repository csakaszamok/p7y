import { describe, it, expect, vi } from 'vitest'
import { createLoginCapacity, capacityHtml } from '../../services/loginCapacity'

function capacity(over: Partial<Parameters<typeof createLoginCapacity>[0]> = {}) {
  let t = 0
  const deps = { used: vi.fn(async () => 143), limit: () => 200 as number | null, enabled: () => true, now: () => t, ttlMs: 30_000, ...over }
  return { deps, c: createLoginCapacity(deps), tick: (ms: number) => { t += ms } }
}

describe('sandbox places on the sign-in page', () => {
  it('taken and the server limit', async () => {
    expect(await capacity().c.get()).toEqual({ used: 143, limit: 200 })
  })

  // The sign-in page needs no session: a reload loop must not list the sandboxes every time
  it('counts at most once every 30 seconds', async () => {
    const { deps, c, tick } = capacity()
    await c.get(); tick(29_000); await c.get()
    expect(deps.used).toHaveBeenCalledTimes(1)
    tick(2_000); await c.get()
    expect(deps.used).toHaveBeenCalledTimes(2)
  })

  it('nothing without a server limit, when turned off, or when counting fails', async () => {
    expect(await capacity({ limit: () => null }).c.get()).toBeNull()
    expect(await capacity({ enabled: () => false }).c.get()).toBeNull()
    expect(await capacity({ used: vi.fn(async () => { throw new Error('docker down') }) }).c.get()).toBeNull()
  })
})

describe('capacityHtml', () => {
  it('taken and free, with a bar', () => {
    const h = capacityHtml({ used: 143, limit: 200 })
    expect(h).toContain('143 taken · 57 free')
    expect(h).toContain('width:72%')
    expect(h).not.toContain('class="capacity warn')
  })
  it('almost full (90% or more): warns', () => {
    expect(capacityHtml({ used: 196, limit: 200 })).toContain('class="capacity warn')
  })
  it('full: says so', () => {
    const h = capacityHtml({ used: 200, limit: 200 })
    expect(h).toContain('The server is full')
    expect(h).toContain('class="capacity full')
    expect(h).toContain('width:100%')
  })
  it('more than the limit (lowered later): full, the bar at 100%', () => {
    expect(capacityHtml({ used: 230, limit: 200 })).toContain('width:100%')
  })
  it('nothing when there is nothing to show', () => {
    expect(capacityHtml(null)).toBe('')
  })
})
