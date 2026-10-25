import { describe, it, expect, afterEach, vi } from 'vitest'
import { sandboxPrefix, sandboxName, rawNameOf, readLabel, labelKey, managedLabelFilters } from '../../services/naming'

afterEach(() => { vi.unstubAllEnvs() })

describe('naming', () => {
  it('names new sandboxes p7y-<raw>, or SANDBOX_PREFIX when set', () => {
    expect(sandboxPrefix()).toBe('p7y')
    expect(sandboxName('shop')).toBe('p7y-shop')
    vi.stubEnv('SANDBOX_PREFIX', 'acme')
    expect(sandboxName('shop')).toBe('acme-shop')
  })

  it('knows the raw name of its own sandboxes only', () => {
    expect(rawNameOf('p7y-shop')).toBe('shop')
    expect(rawNameOf('p7y-leander-x')).toBe('leander-x')
    expect(rawNameOf('leander-shop')).toBeNull()
    expect(rawNameOf('other-shop')).toBeNull()
    vi.stubEnv('SANDBOX_PREFIX', 'acme')
    expect(rawNameOf('acme-shop')).toBe('shop')
    expect(rawNameOf('leander-shop')).toBeNull()
  })

  it('reads p7y.* labels only', () => {
    expect(labelKey('owner')).toBe('p7y.owner')
    expect(readLabel({ 'p7y.owner': 'a', 'leander.owner': 'b' }, 'owner')).toBe('a')
    expect(readLabel({ 'leander.owner': 'b' }, 'owner')).toBeUndefined()
    expect(readLabel(undefined, 'owner')).toBeUndefined()
  })

  it('lists managed containers under one label', () => {
    expect(managedLabelFilters()).toEqual(['p7y.managed=true'])
  })
})
