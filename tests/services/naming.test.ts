import { describe, it, expect, afterEach, vi } from 'vitest'
import { sandboxPrefix, sandboxName, rawNameOf, readLabel, labelKey, managedLabelFilters } from '../../services/naming'

afterEach(() => { vi.unstubAllEnvs() })

describe('naming', () => {
  it('names new sandboxes p9m-<raw>, or SANDBOX_PREFIX when set', () => {
    expect(sandboxPrefix()).toBe('p9m')
    expect(sandboxName('shop')).toBe('p9m-shop')
    vi.stubEnv('SANDBOX_PREFIX', 'acme')
    expect(sandboxName('shop')).toBe('acme-shop')
  })

  it('knows the raw name of its own sandboxes only', () => {
    expect(rawNameOf('p9m-shop')).toBe('shop')
    expect(rawNameOf('p9m-leander-x')).toBe('leander-x')
    expect(rawNameOf('leander-shop')).toBeNull()
    expect(rawNameOf('other-shop')).toBeNull()
    vi.stubEnv('SANDBOX_PREFIX', 'acme')
    expect(rawNameOf('acme-shop')).toBe('shop')
    expect(rawNameOf('leander-shop')).toBeNull()
  })

  it('reads p9m.* labels only', () => {
    expect(labelKey('owner')).toBe('p9m.owner')
    expect(readLabel({ 'p9m.owner': 'a', 'leander.owner': 'b' }, 'owner')).toBe('a')
    expect(readLabel({ 'leander.owner': 'b' }, 'owner')).toBeUndefined()
    expect(readLabel(undefined, 'owner')).toBeUndefined()
  })

  it('lists managed containers under one label', () => {
    expect(managedLabelFilters()).toEqual(['p9m.managed=true'])
  })
})
