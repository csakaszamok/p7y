import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/docker', () => ({
  listManagedContainers: vi.fn(),
  getSandboxState: vi.fn()
}))
vi.mock('../../services/compose', () => ({ composeDown: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../services/project', () => ({
  removeProjectContainers: vi.fn().mockResolvedValue(undefined),
  nudgeTraefik: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('../../services/sandboxPaths', async orig => (await import('../helpers/legacySandboxPaths')).legacySandboxPaths(orig))

vi.mock('fs', async (orig) => {
  const actual = await orig<typeof import('fs')>()
  const mocked = { ...actual, existsSync: vi.fn().mockReturnValue(true) }
  return { ...mocked, default: mocked }
})

import { isDeepSleepDue, runDeepSleepOnce, deepSleepIntervalMs, deepSleepNow, type SandboxStateLike } from '../../services/deepSleep'
import { listManagedContainers, getSandboxState } from '../../services/docker'
import { composeDown } from '../../services/compose'
import { nudgeTraefik, removeProjectContainers } from '../../services/project'
import { sandboxMeta } from '../helpers/sandboxMeta'

const NOW = new Date('2026-10-10T12:00:00Z')
const state = (over: Partial<SandboxStateLike> = {}): SandboxStateLike => ({
  name: 'leander-a', status: 'exited', finishedAt: '2026-10-03T12:00:00Z', deepSleepAfter: '7d', staleNetwork: false, error: '', ...over
})
const meta = (name: string) => sandboxMeta({ name, status: 'exited' })

describe('isDeepSleepDue', () => {
  it('is due once deep_sleep_after has elapsed since the stop', () => {
    expect(isDeepSleepDue(state(), NOW)).toBe(true)
    expect(isDeepSleepDue(state({ finishedAt: '2026-10-03T12:00:01Z' }), NOW)).toBe(false)
  })

  it('never fires for running, off, unlabeled (pre-feature) or bad FinishedAt', () => {
    expect(isDeepSleepDue(state({ status: 'running' }), NOW)).toBe(false)
    expect(isDeepSleepDue(state({ deepSleepAfter: 'off' }), NOW)).toBe(false)
    expect(isDeepSleepDue(state({ deepSleepAfter: undefined }), NOW)).toBe(false)
    expect(isDeepSleepDue(state({ finishedAt: '0001-01-01T00:00:00Z' }), NOW)).toBe(false)
    expect(isDeepSleepDue(state({ finishedAt: 'garbage' }), NOW)).toBe(false)
  })
})

describe('isDeepSleepDue: stale network', () => {
  // The Leander stack's `docker compose down` removes traefik-net; an asleep sandbox
  // still points at the old network and can never start again (exit 128).
  it('is due at once for an asleep sandbox whose network is gone, whatever deep_sleep_after says', () => {
    expect(isDeepSleepDue(state({ staleNetwork: true, finishedAt: '2026-10-10T11:59:00Z' }), NOW)).toBe(true)
    expect(isDeepSleepDue(state({ staleNetwork: true, deepSleepAfter: 'off' }), NOW)).toBe(true)
  })

  it('leaves a running sandbox alone', () => {
    expect(isDeepSleepDue(state({ staleNetwork: true, status: 'running' }), NOW)).toBe(false)
  })
})

describe('runDeepSleepOnce', () => {
  beforeEach(() => {
    vi.mocked(composeDown).mockClear()
    vi.mocked(composeDown).mockResolvedValue(undefined)
  })

  it('takes down due sandboxes', async () => {
    vi.mocked(listManagedContainers).mockResolvedValue([meta('leander-a')])
    vi.mocked(getSandboxState).mockResolvedValue(state())
    await runDeepSleepOnce(NOW)
    expect(composeDown).toHaveBeenCalledWith('/opt/users/leander-a/docker-compose.yml')
  })

  it('nudges Traefik after taking a sandbox down so its stale router is dropped', async () => {
    // Traefik ignores the destroy event of an already-stopped container and would keep
    // routing to the sandbox (404) instead of falling through to Leander /wake.
    vi.mocked(nudgeTraefik).mockClear()
    vi.mocked(listManagedContainers).mockResolvedValue([meta('leander-a')])
    vi.mocked(getSandboxState).mockResolvedValue(state())
    await runDeepSleepOnce(NOW)
    expect(nudgeTraefik).toHaveBeenCalledTimes(1)
    expect(vi.mocked(composeDown).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(nudgeTraefik).mock.invocationCallOrder[0])
  })

  it('re-checks right before down and skips a sandbox that woke up meanwhile', async () => {
    vi.mocked(listManagedContainers).mockResolvedValue([meta('leander-a')])
    vi.mocked(getSandboxState)
      .mockResolvedValueOnce(state())                       // candidate scan
      .mockResolvedValueOnce(state({ status: 'running' }))  // re-check
    await runDeepSleepOnce(NOW)
    expect(composeDown).not.toHaveBeenCalled()
  })

  it('keeps going when one sandbox fails', async () => {
    vi.mocked(listManagedContainers).mockResolvedValue([meta('leander-a'), meta('leander-b')])
    vi.mocked(getSandboxState).mockImplementation(async name => state({ name }))
    vi.mocked(composeDown).mockRejectedValueOnce(new Error('boom'))
    await runDeepSleepOnce(NOW)
    expect(composeDown).toHaveBeenCalledTimes(2)
  })
})

describe('deepSleepIntervalMs', () => {
  it('defaults to 1m and falls back to it on bad input', () => {
    expect(deepSleepIntervalMs(undefined)).toBe(60_000)
    expect(deepSleepIntervalMs('15s')).toBe(15_000)
    expect(deepSleepIntervalMs('5m')).toBe(300_000)
    expect(deepSleepIntervalMs('7d')).toBe(60_000)
    expect(deepSleepIntervalMs('soon')).toBe(60_000)
  })
})

describe('deepSleepNow', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('takes the sandbox down right away, running or not, and tells Traefik', async () => {
    await deepSleepNow('p7y-shop')
    expect(composeDown).toHaveBeenCalledWith('/opt/users/p7y-shop/docker-compose.yml')
    expect(removeProjectContainers).toHaveBeenCalledWith('p7y-shop')
    expect(nudgeTraefik).toHaveBeenCalled()
    expect(getSandboxState).not.toHaveBeenCalled() // no "is it due" check: the user asked for it
  })
})
