import { describe, it, expect, vi } from 'vitest'
import { createSessionWatch, type SessionWatchDeps } from '../../services/sessionWatch'

const STARTED = '2026-10-09T08:09:29Z'

function watch(over: Partial<SessionWatchDeps> = {}) {
  const deps: SessionWatchDeps = {
    running: vi.fn(async () => [{ name: 'p7y-a', startedAt: STARTED }]),
    expiries: vi.fn(async () => new Map<string, number>()),
    prime: vi.fn(async () => true),
    log: vi.fn(),
    ...over,
  }
  return { deps, w: createSessionWatch(deps) }
}

describe('session watch: a running sandbox without a Sablier session gets one', () => {
  // Started outside p7y (or p7y restarted while opening its session): it would never sleep
  it('opens a session once the sandbox ran without one on two scans in a row', async () => {
    const { deps, w } = watch()
    await w.runOnce()
    expect(deps.prime).not.toHaveBeenCalled()
    await w.runOnce()
    expect(deps.prime).toHaveBeenCalledWith('p7y-a')
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('p7y-a'))
  })

  // Sablier is stopping it right now (its session just ran out): a session would wake it again
  it('leaves a sandbox alone that is seen without a session only once', async () => {
    const running = vi.fn()
      .mockResolvedValueOnce([{ name: 'p7y-a', startedAt: STARTED }])
      .mockResolvedValueOnce([])
    const { deps, w } = watch({ running })
    await w.runOnce()
    await w.runOnce()
    expect(deps.prime).not.toHaveBeenCalled()
  })

  it('does not count a restart in between as the same run', async () => {
    const running = vi.fn()
      .mockResolvedValueOnce([{ name: 'p7y-a', startedAt: STARTED }])
      .mockResolvedValueOnce([{ name: 'p7y-a', startedAt: '2026-10-09T08:30:00Z' }])
    const { deps, w } = watch({ running })
    await w.runOnce()
    await w.runOnce()
    expect(deps.prime).not.toHaveBeenCalled()
  })

  it('leaves a sandbox with a session alone, and forgets it was seen without one', async () => {
    const expiries = vi.fn()
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(new Map([['p7y-a', 2_000_000_000]]))
      .mockResolvedValueOnce(new Map())
    const { deps, w } = watch({ expiries })
    await w.runOnce()
    await w.runOnce()
    await w.runOnce()
    expect(deps.prime).not.toHaveBeenCalled()
  })

  // Unreachable Sablier: "no session" cannot be told from "no data", and a session keeps it awake
  it('does nothing while the sessions cannot be read', async () => {
    const { deps, w } = watch({ expiries: vi.fn(async () => null) })
    await w.runOnce()
    await w.runOnce()
    expect(deps.prime).not.toHaveBeenCalled()
  })

  it('opens it once, then waits two scans again if it is still missing', async () => {
    const { deps, w } = watch()
    await w.runOnce()
    await w.runOnce()
    await w.runOnce()
    expect(deps.prime).toHaveBeenCalledTimes(1)
    await w.runOnce()
    expect(deps.prime).toHaveBeenCalledTimes(2)
  })

  it('a failing scan does not throw', async () => {
    const { w } = watch({ running: vi.fn(async () => { throw new Error('docker down') }) })
    await expect(w.runOnce()).resolves.toBeUndefined()
  })
})
