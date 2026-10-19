import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { viewOf, setView } from '../../services/userPrefs'

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-')), 'prefs.json')

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
    expect(viewOf('anna@example.com', 'user', f)).toBe('advanced')
    expect(viewOf('admin', 'admin', f)).toBe('simple')
    expect(viewOf('peter@example.com', 'user', f)).toBe('simple')
  })
})
