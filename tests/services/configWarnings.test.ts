import { describe, it, expect } from 'vitest'
import { insecureConfigWarnings, insecureConfigErrors } from '../../services/configWarnings'

describe('insecureConfigWarnings', () => {
  it('warns when ADMIN_TOKEN is the default "abc123"', () => {
    const warnings = insecureConfigWarnings({ ADMIN_TOKEN: 'abc123' })
    expect(warnings.some(w => w.includes('ADMIN_TOKEN'))).toBe(true)
  })

  it('warns when SESSION_SECRET is the default placeholder', () => {
    const warnings = insecureConfigWarnings({ SESSION_SECRET: 'change-me-to-a-long-random-string' })
    expect(warnings.some(w => w.includes('SESSION_SECRET'))).toBe(true)
  })

  it('warns when ADMIN_PASSWORD is the default "change-me"', () => {
    const warnings = insecureConfigWarnings({ ADMIN_PASSWORD: 'change-me' })
    expect(warnings.some(w => w.includes('ADMIN_PASSWORD'))).toBe(true)
  })

  it('returns no warnings once all three are set to something else', () => {
    const warnings = insecureConfigWarnings({
      ADMIN_TOKEN: 'a-real-secret',
      SESSION_SECRET: 'a-real-long-random-string',
      ADMIN_PASSWORD: 'a-real-password'
    })
    expect(warnings).toEqual([])
  })

  it('returns no warnings for an empty env (unset, not the insecure default)', () => {
    expect(insecureConfigWarnings({})).toEqual([])
  })
})

describe('insecureConfigErrors', () => {
  const strong = { ADMIN_TOKEN: 'x'.repeat(32), SESSION_SECRET: 'y'.repeat(64), ADMIN_PASSWORD: 'pw-strong' }

  it('blocks a public (https) start with default or example secrets', () => {
    const https = { PUBLIC_URL: 'https://p7y.example.com' }
    for (const [key, value] of [['ADMIN_TOKEN', 'abc123'], ['ADMIN_TOKEN', 'change-me-to-a-strong-secret'],
      ['SESSION_SECRET', 'change-me-to-a-long-random-string'], ['SESSION_SECRET', ''], ['ADMIN_PASSWORD', 'change-me']]) {
      const errors = insecureConfigErrors({ ...https, ...strong, [key]: value })
      expect(errors.some(e => e.includes(key))).toBe(true)
    }
    const { SESSION_SECRET: _omit, ...noSecret } = strong
    expect(insecureConfigErrors({ ...https, ...noSecret }).some(e => e.includes('SESSION_SECRET'))).toBe(true)
    expect(insecureConfigErrors({ ...https, ...strong })).toEqual([])
  })

  it('never blocks a plain-http (local) start', () => {
    expect(insecureConfigErrors({ PUBLIC_URL: 'http://p7y.lvh.me', ADMIN_TOKEN: 'abc123' })).toEqual([])
    expect(insecureConfigErrors({ ADMIN_TOKEN: 'abc123' })).toEqual([])
  })
})

describe('insecureConfigWarnings: .env.example admin token', () => {
  it('warns when ADMIN_TOKEN is the .env.example placeholder', () => {
    expect(insecureConfigWarnings({ ADMIN_TOKEN: 'change-me-to-a-strong-secret' }).some(w => w.includes('ADMIN_TOKEN'))).toBe(true)
  })
})
