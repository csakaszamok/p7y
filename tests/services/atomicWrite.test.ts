import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { writeFileAtomic } from '../../services/atomicWrite'

describe('writeFileAtomic', () => {
  it('writes through a temp file and a rename', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-aw-')), 'x.json')
    writeFileAtomic(f, '{"a":1}')
    expect(fs.readFileSync(f, 'utf8')).toBe('{"a":1}')
  })
  // Windows: a virus scanner holding the fresh file makes rename fail with EPERM for a moment
  it('retries a rename that fails for a moment, and gives up on a lasting failure', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-aw-')), 'y.json')
    let fails = 2
    const rename = vi.fn((a: string, b: string) => { if (fails-- > 0) throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); fs.renameSync(a, b) })
    writeFileAtomic(f, 'ok', { rename })
    expect(fs.readFileSync(f, 'utf8')).toBe('ok')
    expect(rename).toHaveBeenCalledTimes(3)
    const always = vi.fn(() => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }) })
    expect(() => writeFileAtomic(f, 'no', { rename: always })).toThrow('EPERM')
  })
})
