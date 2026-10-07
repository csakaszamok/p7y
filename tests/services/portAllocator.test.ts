import { describe, it, expect } from 'vitest'
import { allocatePort } from '../../services/portAllocator'

describe('allocatePort', () => {
  it('returns first port in range when all free', () => {
    expect(allocatePort(new Set(), 32000, 32005)).toBe(32000)
  })
  it('skips occupied ports', () => {
    expect(allocatePort(new Set([32000]), 32000, 32005)).toBe(32001)
  })
  it('returns null when range is exhausted', () => {
    expect(allocatePort(new Set([32000]), 32000, 32000)).toBeNull()
  })
})
