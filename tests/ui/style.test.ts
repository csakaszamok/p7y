import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'ui', 'style.css'), 'utf8')

describe('style.css', () => {
  // button.primary sets display, which beat the browser's own [hidden] rule: the export dialog showed
  // "Enable Docker access and export" (new keys, a restart) to sandboxes that already had Docker access
  it('hidden always hides, whatever display a class sets', () => {
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important\s*;?\s*\}/)
  })
})
