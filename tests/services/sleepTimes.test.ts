import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SandboxState } from '../../services/docker'

vi.mock('../../services/docker', () => ({ getSandboxState: vi.fn() }))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { parseSessionExpiries, sleepTimes } from '../../services/sleepTimes'
import { getSandboxState } from '../../services/docker'

// Real output of Sablier 1.18 /metrics (trimmed)
const METRICS = `# HELP sablier_session_expires_at_timestamp_seconds Unix timestamp (seconds) at which the instance's session expires.
# TYPE sablier_session_expires_at_timestamp_seconds gauge
sablier_session_expires_at_timestamp_seconds{group="leander-cd656a",instance="leander-cd656a"} 1.790514528e+09
sablier_session_expires_at_timestamp_seconds{group="leander-cd656a",instance="leander-cd656a-frps"} 1.790514527e+09
sablier_session_expires_at_timestamp_seconds{group="leander-cd656a",instance="leander-cd656a-socat"} 1.790514528e+09
sablier_session_expires_at_timestamp_seconds{group="leander-my-first",instance="leander-my-first"} 1.790515825e+09
sablier_session_requests_total{strategy="dynamic",target="group"} 12
garbage line
`

const NOW = new Date('2026-09-27T13:00:00Z')
const running: SandboxState = { name: 'leander-cd656a', status: 'running', finishedAt: '0001-01-01T00:00:00Z', deepSleepAfter: '7d', staleNetwork: false, error: '' }

describe('parseSessionExpiries', () => {
  it('maps each group to its earliest session expiry and ignores other lines', () => {
    const m = parseSessionExpiries(METRICS)
    expect(m.get('leander-cd656a')).toBe(1790514527)
    expect(m.get('leander-my-first')).toBe(1790515825)
    expect(m.size).toBe(2)
  })
})

describe('sleepTimes', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({ ok: true, text: async () => METRICS })
  })

  it('running with an active session: when it stops; deep sleep counts from the stop', async () => {
    vi.mocked(getSandboxState).mockResolvedValue(running)
    expect(await sleepTimes('leander-cd656a', NOW)).toEqual({
      stops_at: new Date(1790514527 * 1000).toISOString(),
      stops_in: 527,
      deep_sleep_at: null,
      deep_sleep_in: null,
      deep_sleep_after: '7d',
      going_to_sleep: false
    })
    expect(mockFetch).toHaveBeenCalledWith('http://sablier:10000/metrics', expect.anything())
  })

  it('running without a session yet (no request so far): no stop time', async () => {
    vi.mocked(getSandboxState).mockResolvedValue({ ...running, name: 'leander-nosession' })
    expect((await sleepTimes('leander-nosession', NOW)).stops_at).toBeNull()
  })

  it('asleep: deep sleep is deep_sleep_after after the stop; off means never', async () => {
    vi.mocked(getSandboxState).mockResolvedValue({ ...running, status: 'exited', finishedAt: '2026-09-27T12:00:00Z' })
    expect(await sleepTimes('leander-cd656a', NOW)).toEqual({ stops_at: null, stops_in: null, deep_sleep_at: '2026-10-04T12:00:00.000Z', deep_sleep_in: 601200, deep_sleep_after: '7d', going_to_sleep: false })
    vi.mocked(getSandboxState).mockResolvedValue({ ...running, status: 'exited', finishedAt: '2026-09-27T12:00:00Z', deepSleepAfter: 'off' })
    expect(await sleepTimes('leander-cd656a', NOW)).toEqual({ stops_at: null, stops_in: null, deep_sleep_at: null, deep_sleep_in: null, deep_sleep_after: 'off', going_to_sleep: false })
  })

  it('deep sleep (no container) or unknown: nothing to count down', async () => {
    vi.mocked(getSandboxState).mockResolvedValue(null)
    expect(await sleepTimes('leander-gone', NOW)).toEqual({ stops_at: null, stops_in: null, deep_sleep_at: null, deep_sleep_in: null, deep_sleep_after: null, going_to_sleep: false })
  })

  it('Sablier unreachable or failing: stop time unknown, the rest still works', async () => {
    vi.mocked(getSandboxState).mockResolvedValue(running)
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    expect(await sleepTimes('leander-cd656a', NOW)).toEqual({ stops_at: null, stops_in: null, deep_sleep_at: null, deep_sleep_in: null, deep_sleep_after: '7d', going_to_sleep: false })
    mockFetch.mockResolvedValueOnce({ ok: false, text: async () => '' })
    expect((await sleepTimes('leander-cd656a', NOW)).stops_at).toBeNull()
  })
})

describe('sleepTimesMany', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({ ok: true, text: async () => METRICS })
  })

  it('answers for every sandbox with a single Sablier metrics request', async () => {
    const { sleepTimesMany } = await import('../../services/sleepTimes')
    vi.mocked(getSandboxState).mockImplementation(async name =>
      name === 'leander-cd656a' ? running
        : name === 'leander-my-first' ? { ...running, name }
        : { ...running, name, status: 'exited', finishedAt: '2026-09-27T12:00:00Z' })
    const times = await sleepTimesMany(['leander-cd656a', 'leander-my-first', 'leander-asleep'], NOW)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(times.get('leander-cd656a')?.stops_at).toBe(new Date(1790514527 * 1000).toISOString())
    expect(times.get('leander-my-first')?.stops_at).toBe(new Date(1790515825 * 1000).toISOString())
    // how long is left, by the server's clock: the browser counts down from this, whatever its own clock says
    expect(times.get('leander-my-first')?.stops_in).toBe(1825)
    expect(times.get('leander-asleep')).toEqual({ stops_at: null, stops_in: null, deep_sleep_at: '2026-10-04T12:00:00.000Z', deep_sleep_in: 601200, deep_sleep_after: '7d', going_to_sleep: false })
  })

  it('skips the metrics request when nothing is running', async () => {
    const { sleepTimesMany } = await import('../../services/sleepTimes')
    vi.mocked(getSandboxState).mockResolvedValue({ ...running, status: 'exited', finishedAt: '2026-09-27T12:00:00Z' })
    await sleepTimesMany(['leander-a', 'leander-b'], NOW)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('sleepTimes: going to sleep', () => {
  // Sablier drops a session from /metrics when it expires, but stops the containers a few minutes later
  const EXPIRY = 1790514527
  const metricsWithout = METRICS.split('\n').filter(l => !l.includes('leander-cd656a')).join('\n')
  beforeEach(() => mockFetch.mockReset())

  it('running, its session just expired and gone from Sablier: going to sleep (not "not counting yet")', async () => {
    vi.mocked(getSandboxState).mockResolvedValue({ ...running, startedAt: '2026-09-27T12:30:00Z' })
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => METRICS })
    expect((await sleepTimes('leander-cd656a', NOW)).going_to_sleep).toBe(false)
    mockFetch.mockResolvedValue({ ok: true, text: async () => metricsWithout })
    const after = new Date((EXPIRY + 60) * 1000)
    expect(await sleepTimes('leander-cd656a', after)).toMatchObject({ stops_at: null, going_to_sleep: true })
    // Not forever: a quarter of an hour later it is no longer a delay of Sablier's
    expect((await sleepTimes('leander-cd656a', new Date((EXPIRY + 16 * 60) * 1000))).going_to_sleep).toBe(false)
  })
  it('woken again after that expiry: not counting yet, not going to sleep', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => METRICS })
    vi.mocked(getSandboxState).mockResolvedValue({ ...running, startedAt: '2026-09-27T12:30:00Z' })
    await sleepTimes('leander-cd656a', NOW)
    mockFetch.mockResolvedValue({ ok: true, text: async () => metricsWithout })
    vi.mocked(getSandboxState).mockResolvedValue({ ...running, startedAt: new Date((EXPIRY + 30) * 1000).toISOString() })
    expect((await sleepTimes('leander-cd656a', new Date((EXPIRY + 60) * 1000))).going_to_sleep).toBe(false)
  })
})

describe('sleepTimes: recreated, never started', () => {
  it('deep sleep counts from when the container was created', async () => {
    mockFetch.mockResolvedValue({ ok: true, text: async () => METRICS })
    vi.mocked(getSandboxState).mockResolvedValue({ ...running, status: 'created', finishedAt: '0001-01-01T00:00:00Z', createdAt: '2026-09-27T12:00:00Z' })
    expect(await sleepTimes('leander-cd656a', NOW)).toMatchObject({ deep_sleep_at: '2026-10-04T12:00:00.000Z', deep_sleep_in: 601200 })
  })
})
