import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { recordSignIn, recordSeen, recordSandboxCreated, listUserStats, deleteUserStats, _resetSeen } from '../../services/userStats'

let file: string
beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stats-')), 'user-stats.json')
  _resetSeen()
})
const t = (iso: string) => new Date(iso)

describe('userStats', () => {
  it('a sign-in: first and last seen, last sign-in, the count', () => {
    recordSignIn('Anna@Example.com', t('2026-10-01T10:00:00Z'), file)
    recordSignIn('anna@example.com', t('2026-10-05T09:00:00Z'), file)
    expect(listUserStats(file)).toEqual([{
      sub: 'anna@example.com', first_seen: '2026-10-01T10:00:00.000Z', last_seen: '2026-10-05T09:00:00.000Z',
      last_sign_in: '2026-10-05T09:00:00.000Z', sign_ins: 2, sandboxes_created: 0, last_sandbox_created: null,
    }])
  })
  it('seen: moves last_seen, at most once in 10 minutes per user, without a sign-in', () => {
    recordSeen('bob@example.com', t('2026-10-01T10:00:00Z'), file)
    recordSeen('bob@example.com', t('2026-10-01T10:05:00Z'), file)
    expect(listUserStats(file)[0]).toMatchObject({ first_seen: '2026-10-01T10:00:00.000Z', last_seen: '2026-10-01T10:00:00.000Z', sign_ins: 0, last_sign_in: null })
    recordSeen('bob@example.com', t('2026-10-01T10:11:00Z'), file)
    expect(listUserStats(file)[0].last_seen).toBe('2026-10-01T10:11:00.000Z')
  })
  it('a created sandbox counts and is remembered', () => {
    recordSignIn('anna@example.com', t('2026-10-01T10:00:00Z'), file)
    recordSandboxCreated('anna@example.com', t('2026-10-02T08:00:00Z'), file)
    recordSandboxCreated('anna@example.com', t('2026-10-03T08:00:00Z'), file)
    expect(listUserStats(file)[0]).toMatchObject({ sandboxes_created: 2, last_sandbox_created: '2026-10-03T08:00:00.000Z', last_seen: '2026-10-03T08:00:00.000Z' })
  })
  it('lists by last seen, newest first; deletes one', () => {
    recordSignIn('old@example.com', t('2026-09-01T10:00:00Z'), file)
    recordSignIn('new@example.com', t('2026-10-01T10:00:00Z'), file)
    expect(listUserStats(file).map(u => u.sub)).toEqual(['new@example.com', 'old@example.com'])
    expect(deleteUserStats('OLD@example.com', file)).toBe(true)
    expect(deleteUserStats('old@example.com', file)).toBe(false)
    expect(listUserStats(file).map(u => u.sub)).toEqual(['new@example.com'])
  })
  it('a missing or broken file is an empty list', () => {
    expect(listUserStats(file)).toEqual([])
    fs.writeFileSync(file, '{not json')
    expect(listUserStats(file)).toEqual([])
  })
})

describe('userStats: a broken file', () => {
  it('is not overwritten by a sign-in, and the sign-in goes on', () => {
    fs.writeFileSync(file, '{not json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => recordSignIn('anna@example.com', t('2026-10-01T10:00:00Z'), file)).not.toThrow()
    expect(fs.readFileSync(file, 'utf8')).toBe('{not json')
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/cannot record anna@example.com/))
    warn.mockRestore()
  })
})
