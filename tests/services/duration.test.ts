import { describe, it, expect } from 'vitest'
import { parseDuration } from '../../services/duration'

describe('parseDuration', () => {
  it('parses each unit into milliseconds', () => {
    expect(parseDuration('30s')).toBe(30_000)
    expect(parseDuration('15m')).toBe(900_000)
    expect(parseDuration('2h')).toBe(7_200_000)
    expect(parseDuration('7d')).toBe(604_800_000)
  })

  it('returns null for off and anything malformed', () => {
    for (const v of ['off', '', '0m', '7', '1.5h', '7D', ' 7d', '7d\n', '7w', 7, null, undefined]) {
      expect(parseDuration(v)).toBeNull()
    }
  })

  it('rejects units outside the allowed set', () => {
    expect(parseDuration('30s', 'mhd')).toBeNull()
    expect(parseDuration('7d', 'smh')).toBeNull()
    expect(parseDuration('12h', 'mhd')).toBe(43_200_000)
  })
})
