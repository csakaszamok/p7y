import { describe, it, expect, vi, afterEach } from 'vitest'
import { startTrafficKeepAlive } from '../../services/trafficKeepAlive'

afterEach(() => { vi.useRealTimers() })

describe('keeping a sandbox awake from a connection: only while something goes through it', () => {
  it('renews once a minute while bytes flow', async () => {
    vi.useFakeTimers()
    let last = Date.now()
    const renew = vi.fn()
    const stop = startTrafficKeepAlive(() => last, renew, 60_000)
    vi.advanceTimersByTime(30_000); last = Date.now()   // a build streaming its output
    vi.advanceTimersByTime(30_000)
    expect(renew).toHaveBeenCalledTimes(1)
    stop()
  })

  // Docker Desktop keeps a sandbox's context connected for its Builds view, sending nothing
  it('does not renew for a connection that is only open', async () => {
    vi.useFakeTimers()
    const opened = Date.now()
    const renew = vi.fn()
    const stop = startTrafficKeepAlive(() => opened, renew, 60_000)
    vi.advanceTimersByTime(60_000 * 5)
    expect(renew).not.toHaveBeenCalled()
    stop()
  })

  it('stops renewing once stopped', async () => {
    vi.useFakeTimers()
    const renew = vi.fn()
    const stop = startTrafficKeepAlive(() => Date.now(), renew, 60_000)
    stop()
    vi.advanceTimersByTime(60_000 * 3)
    expect(renew).not.toHaveBeenCalled()
  })
})
