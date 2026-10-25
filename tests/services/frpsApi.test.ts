import { describe, it, expect } from 'vitest'
import { frpsToml, frpsApiAuth } from '../../services/frpsApi'

describe('the frps API password', () => {
  it('a new sandbox: frps.toml with a user and password for its API', () => {
    const toml = frpsToml('tok', 'pw123')
    expect(toml).toContain('token = "tok"')
    expect(toml).toMatch(/\[webServer\][\s\S]*user = "p9m"[\s\S]*password = "pw123"/)
    expect(frpsApiAuth(toml)).toBe('p9m:pw123')
  })
  it('a frps.toml without a password: null', () => {
    expect(frpsApiAuth('bindPort = 7000\n[auth]\ntoken = "tok"\n[webServer]\naddr = "0.0.0.0"\nport = 7500\n')).toBeNull()
  })
})
