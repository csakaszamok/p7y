import { describe, it, expect, beforeEach } from 'vitest'
import { startDevice, normalizeUserCode, deviceByUserCode, approveDevice, denyDevice, pollDevice, _resetDevices, DEVICE_TTL_MS, DEVICE_MAX_PENDING } from '../../services/deviceAuth'

const T = 1_000_000
const grant = { sandbox: 'p9m-shop', owner: 'alice' }

beforeEach(() => _resetDevices())

describe('device codes', () => {
  it('start, pending, approve, approved once, then expired', () => {
    const { device_code, user_code } = startDevice('p9m-shop', T)
    expect(device_code).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(pollDevice(device_code, T + 1)).toEqual({ status: 'pending' })
    expect(deviceByUserCode(user_code, T + 1)).toEqual({ sandbox: 'p9m-shop', status: 'pending' })
    expect(approveDevice(user_code, grant, T + 2)).toBe(true)
    expect(deviceByUserCode(user_code, T + 3)?.status).toBe('approved')
    expect(approveDevice(user_code, grant, T + 3)).toBe(false)
    expect(pollDevice(device_code, T + 4)).toEqual({ status: 'approved', ...grant })
    expect(pollDevice(device_code, T + 5)).toEqual({ status: 'expired' })
    expect(deviceByUserCode(user_code, T + 5)).toBeNull()
  })

  it('deny, denied once, then expired', () => {
    const { device_code, user_code } = startDevice(null, T)
    expect(deviceByUserCode(user_code, T)).toEqual({ sandbox: null, status: 'pending' })
    expect(denyDevice(user_code, T + 1)).toBe(true)
    expect(denyDevice(user_code, T + 1)).toBe(false)
    expect(pollDevice(device_code, T + 2)).toEqual({ status: 'denied' })
    expect(pollDevice(device_code, T + 3)).toEqual({ status: 'expired' })
  })

  it('the user code is XXXX-XXXX and found however it is typed', () => {
    const { user_code } = startDevice(null, T)
    expect(user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/)
    const typed = user_code.toLowerCase().replace('-', ' ')
    expect(normalizeUserCode(typed)).toBe(user_code.replace('-', ''))
    expect(deviceByUserCode(typed, T)).not.toBeNull()
    expect(deviceByUserCode('bcdf ghjk', T)).toBeNull()
  })

  it('expires after the TTL', () => {
    const { device_code, user_code } = startDevice(null, T)
    expect(deviceByUserCode(user_code, T + DEVICE_TTL_MS)).toBeNull()
    expect(approveDevice(user_code, grant, T + DEVICE_TTL_MS)).toBe(false)
    expect(denyDevice(user_code, T + DEVICE_TTL_MS)).toBe(false)
    expect(pollDevice(device_code, T + DEVICE_TTL_MS)).toEqual({ status: 'expired' })
    expect(pollDevice('nope', T)).toEqual({ status: 'expired' })
  })

  it('caps the pending ones, but not the expired', () => {
    for (let i = 0; i < DEVICE_MAX_PENDING; i++) startDevice(null, T)
    expect(() => startDevice(null, T + 1)).toThrow('too many pending')
    expect(() => startDevice(null, T + DEVICE_TTL_MS)).not.toThrow()
  })
})
