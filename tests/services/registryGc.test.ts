import { describe, it, expect } from 'vitest'
import { gcDue } from '../../services/registryGc'

describe('gcDue', () => {
  it('runs once a week, also across restarts (the last run is remembered)', () => {
    const week = 7 * 24 * 3600_000, now = Date.parse('2026-10-10T03:00:00Z')
    expect(gcDue(null, now)).toBe(true)
    expect(gcDue(new Date(now - week + 3600_000).toISOString(), now)).toBe(false)
    expect(gcDue(new Date(now - week - 1).toISOString(), now)).toBe(true)
  })
})
