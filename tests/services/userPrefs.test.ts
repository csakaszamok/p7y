import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { viewOf, setView, canSwitchView } from '../../services/userPrefs'

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-')), 'prefs.json')
const on = { USER_VIEW_SWITCH: 'true' }

describe('the Simple / Advanced view', () => {
  it('is Simple for a user and Advanced for the admin until they choose', () => {
    const f = file()
    expect(viewOf('anna@example.com', 'user', f)).toBe('simple')
    expect(viewOf('admin', 'admin', f)).toBe('advanced')
  })
  it('remembers each account’s choice (by e-mail, any case)', () => {
    const f = file()
    setView('Anna@Example.com', 'advanced', f)
    setView('admin', 'simple', f)
    expect(viewOf('anna@example.com', 'user', f, on)).toBe('advanced')
    expect(viewOf('admin', 'admin', f)).toBe('simple')
    expect(viewOf('peter@example.com', 'user', f, on)).toBe('simple')
  })
})

describe('USER_VIEW_SWITCH', () => {
  it('only the literal true (any case) lets users switch; the admin always may', () => {
    expect(canSwitchView('user', {})).toBe(false)
    expect(canSwitchView('user', { USER_VIEW_SWITCH: 'false' })).toBe(false)
    expect(canSwitchView('user', { USER_VIEW_SWITCH: 'yes' })).toBe(false)
    expect(canSwitchView('user', { USER_VIEW_SWITCH: 'TRUE' })).toBe(true)
    expect(canSwitchView('user', on)).toBe(true)
    expect(canSwitchView('admin', {})).toBe(true)
  })
  it('without it a user is in Simple whatever they chose, and the choice is kept for when it is on', () => {
    const f = file()
    setView('anna@example.com', 'advanced', f)
    setView('admin', 'simple', f)
    expect(viewOf('anna@example.com', 'user', f, {})).toBe('simple')
    expect(viewOf('anna@example.com', 'user', f, on)).toBe('advanced')
    expect(viewOf('admin', 'admin', f, {})).toBe('simple')
    expect(viewOf('root', 'admin', f, {})).toBe('advanced')
  })
})
