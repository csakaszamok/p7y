import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('ADMIN_TOKEN', 'test-secret')

import { isAdmin, adminGuard } from '../../services/auth'

describe('isAdmin', () => {
  it('returns true for matching token', () => {
    const req = new Request('http://localhost', { headers: { Authorization: 'Bearer test-secret' } })
    expect(isAdmin(req)).toBe(true)
  })

  it('returns false when header is missing', () => {
    expect(isAdmin(new Request('http://localhost'))).toBe(false)
  })

  it('returns false for wrong token', () => {
    const req = new Request('http://localhost', { headers: { Authorization: 'Bearer wrong' } })
    expect(isAdmin(req)).toBe(false)
  })
})

describe('adminGuard', () => {
  it('returns null for valid admin', () => {
    const req = new Request('http://localhost', { headers: { Authorization: 'Bearer test-secret' } })
    expect(adminGuard(req)).toBeNull()
  })

  it('returns 401 Response for invalid token', async () => {
    const res = adminGuard(new Request('http://localhost'))
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
    const body = await res!.json()
    expect(body.error).toBe('Unauthorized')
  })
})
