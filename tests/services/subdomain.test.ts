import { describe, it, expect } from 'vitest'
import { subdomainOf } from '../../services/subdomain'

// p9m.subdomain is the only name (foxglove 0.9.0+ reads only it as well).
describe('subdomainOf', () => {
  it('reads p9m.subdomain', () => {
    expect(subdomainOf({ 'p9m.subdomain': 'shop' })).toBe('shop')
  })
  it('ignores the old names p7y.subdomain and frpc.subdomain', () => {
    expect(subdomainOf({ 'p7y.subdomain': 'shop' })).toBeUndefined()
    expect(subdomainOf({ 'frpc.subdomain': 'shop' })).toBeUndefined()
    expect(subdomainOf({ 'frpc.subdomain': 'old', 'p9m.subdomain': 'new' })).toBe('new')
  })
  it('an empty p9m.subdomain, or none: undefined', () => {
    expect(subdomainOf({ 'p9m.subdomain': '' })).toBeUndefined()
    expect(subdomainOf({})).toBeUndefined()
    expect(subdomainOf(undefined)).toBeUndefined()
  })
  it('accepts compose list-form labels (key=value)', () => {
    expect(subdomainOf(['frpc.subdomain=old', 'p9m.subdomain=new'])).toBe('new')
    expect(subdomainOf(['frpc.subdomain=old'])).toBeUndefined()
    expect(subdomainOf(['other=x'])).toBeUndefined()
  })
})
