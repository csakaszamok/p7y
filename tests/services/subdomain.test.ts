import { describe, it, expect } from 'vitest'
import { subdomainOf } from '../../services/subdomain'

// p7y.subdomain is the name; frpc.subdomain is the older one and still works (foxglove 0.8.0+ reads them the same way).
describe('subdomainOf', () => {
  it('reads p7y.subdomain', () => {
    expect(subdomainOf({ 'p7y.subdomain': 'shop' })).toBe('shop')
  })
  it('falls back to the older frpc.subdomain', () => {
    expect(subdomainOf({ 'frpc.subdomain': 'shop' })).toBe('shop')
  })
  it('p7y.subdomain wins when both are set', () => {
    expect(subdomainOf({ 'frpc.subdomain': 'old', 'p7y.subdomain': 'new' })).toBe('new')
  })
  it('an empty p7y.subdomain does not hide frpc.subdomain; neither set: undefined', () => {
    expect(subdomainOf({ 'p7y.subdomain': '', 'frpc.subdomain': 'old' })).toBe('old')
    expect(subdomainOf({})).toBeUndefined()
    expect(subdomainOf(undefined)).toBeUndefined()
  })
  it('accepts compose list-form labels (key=value)', () => {
    expect(subdomainOf(['frpc.subdomain=old', 'p7y.subdomain=new'])).toBe('new')
    expect(subdomainOf(['frpc.subdomain=old'])).toBe('old')
    expect(subdomainOf(['other=x'])).toBeUndefined()
  })
})
