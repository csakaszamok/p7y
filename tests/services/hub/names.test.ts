import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rememberName, nameOf } from '../../../services/hub/names'

describe('owner names', () => {
  it('remembers the latest name per e-mail and ignores empty ones', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hubnames-')), 'names.json')
    expect(nameOf('anna@example.com', file)).toBeNull()
    rememberName('Anna@Example.com', 'Anna Kovács', file)
    rememberName('anna@example.com', null, file)
    rememberName('anna@example.com', '  ', file)
    expect(nameOf('anna@example.com', file)).toBe('Anna Kovács')
  })
})
