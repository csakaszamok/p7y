import { describe, it, expect, beforeEach } from 'vitest'
import { startDevice, normalizeUserCode, deviceByUserCode, claimDevice, releaseDevice, approveDevice, denyDevice, redeemDevice, _resetDevices, DEVICE_TTL_MS, DEVICE_MAX_PENDING, DEVICE_MAX_TRIES } from '../../services/deviceAuth'

const T = 1_000_000
const grant = { sandbox: 'p9m-shop', owner: 'alice' }
const CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/

beforeEach(() => _resetDevices())

describe('device codes', () => {
  it('start, claim, approve with a confirmation code, redeemed once with it, then expired', () => {
    const { device_code, user_code } = startDevice({ sandbox: 'p9m-shop', ip: '203.0.113.5' }, T)
    expect(device_code).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(deviceByUserCode(user_code, T + 1)).toEqual({ sandbox: 'p9m-shop', template: null, ip: '203.0.113.5', status: 'pending' })
    expect(redeemDevice(device_code, 'BCDF-GHJK', T + 1)).toEqual({ status: 'pending' })
    // Not claimed: no approval
    expect(approveDevice(user_code, grant, T + 2)).toBeNull()
    expect(claimDevice(user_code, T + 2)).toBe(true)
    expect(claimDevice(user_code, T + 2)).toBe(false)
    expect(deviceByUserCode(user_code, T + 2)?.status).toBe('working')
    const confirm = approveDevice(user_code, grant, T + 3)
    expect(confirm).toMatch(CODE)
    expect(confirm).not.toBe(user_code)
    expect(deviceByUserCode(user_code, T + 3)?.status).toBe('approved')
    expect(approveDevice(user_code, grant, T + 3)).toBeNull()
    // Typed however: lower case, a space for the dash
    expect(redeemDevice(device_code, confirm!.toLowerCase().replace('-', ' '), T + 4)).toEqual({ status: 'approved', ...grant })
    expect(redeemDevice(device_code, confirm!, T + 5)).toEqual({ status: 'expired' })
    expect(deviceByUserCode(user_code, T + 5)).toBeNull()
  })

  it('the user code is not the confirmation code', () => {
    const { device_code, user_code } = startDevice({}, T)
    claimDevice(user_code, T)
    approveDevice(user_code, grant, T)
    expect(redeemDevice(device_code, user_code, T)).toMatchObject({ status: 'wrong' })
  })

  it('a wrong confirmation code counts; the fifth ends the request', () => {
    const { device_code, user_code } = startDevice({}, T)
    claimDevice(user_code, T)
    const confirm = approveDevice(user_code, grant, T)!
    for (let i = 1; i < DEVICE_MAX_TRIES; i++) expect(redeemDevice(device_code, 'BBBB-BBBB', T)).toEqual({ status: 'wrong', tries_left: DEVICE_MAX_TRIES - i })
    expect(redeemDevice(device_code, 'BBBB-BBBB', T)).toEqual({ status: 'expired' })
    expect(redeemDevice(device_code, confirm, T)).toEqual({ status: 'expired' })
  })

  it('released after a failed approval: pending again', () => {
    const { user_code } = startDevice({ template: 'starter' }, T)
    claimDevice(user_code, T)
    releaseDevice(user_code, T)
    expect(deviceByUserCode(user_code, T)).toMatchObject({ template: 'starter', status: 'pending' })
    expect(claimDevice(user_code, T)).toBe(true)
  })

  it('deny, denied once, then expired', () => {
    const { device_code, user_code } = startDevice({}, T)
    expect(deviceByUserCode(user_code, T)).toEqual({ sandbox: null, template: null, ip: null, status: 'pending' })
    expect(denyDevice(user_code, T + 1)).toBe(true)
    expect(denyDevice(user_code, T + 1)).toBe(false)
    expect(redeemDevice(device_code, 'BCDF-GHJK', T + 2)).toEqual({ status: 'denied' })
    expect(redeemDevice(device_code, 'BCDF-GHJK', T + 3)).toEqual({ status: 'expired' })
  })

  it('the user code is XXXX-XXXX and found however it is typed', () => {
    const { user_code } = startDevice({}, T)
    expect(user_code).toMatch(CODE)
    const typed = user_code.toLowerCase().replace('-', ' ')
    expect(normalizeUserCode(typed)).toBe(user_code.replace('-', ''))
    expect(deviceByUserCode(typed, T)).not.toBeNull()
    expect(deviceByUserCode('bcdf ghjk', T)).toBeNull()
  })

  it('expires after the TTL; an approval gives the TTL again to paste the code', () => {
    const { device_code, user_code } = startDevice({}, T)
    expect(deviceByUserCode(user_code, T + DEVICE_TTL_MS)).toBeNull()
    expect(claimDevice(user_code, T + DEVICE_TTL_MS)).toBe(false)
    expect(denyDevice(user_code, T + DEVICE_TTL_MS)).toBe(false)
    expect(redeemDevice(device_code, 'BCDF-GHJK', T + DEVICE_TTL_MS)).toEqual({ status: 'expired' })
    expect(redeemDevice('nope', 'BCDF-GHJK', T)).toEqual({ status: 'expired' })

    const late = startDevice({}, T)
    claimDevice(late.user_code, T + DEVICE_TTL_MS - 1)
    const confirm = approveDevice(late.user_code, grant, T + DEVICE_TTL_MS - 1)!
    expect(redeemDevice(late.device_code, confirm, T + 2 * DEVICE_TTL_MS - 2)).toEqual({ status: 'approved', ...grant })
  })

  it('caps the pending ones, but not the expired', () => {
    for (let i = 0; i < DEVICE_MAX_PENDING; i++) startDevice({}, T)
    expect(() => startDevice({}, T + 1)).toThrow('too many pending')
    expect(() => startDevice({}, T + DEVICE_TTL_MS)).not.toThrow()
  })
})
