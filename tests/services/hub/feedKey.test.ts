import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFeedKey, feedKeyValid } from '../../../services/hub/feedKey'

describe('feed key', () => {
  it('no key until created; a new key ends the old one; stored hashed', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hubkey-')), 'key')
    expect(feedKeyValid('anything', f)).toBe(false)
    const a = createFeedKey(f)
    expect(feedKeyValid(a, f)).toBe(true)
    expect(fs.readFileSync(f, 'utf8')).not.toContain(a)
    const b = createFeedKey(f)
    expect(feedKeyValid(a, f)).toBe(false)
    expect(feedKeyValid(b, f)).toBe(true)
    expect(feedKeyValid(null, f)).toBe(false)
  })
})
