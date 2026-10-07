import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Sablier serves these waiting pages on the sandbox's own host, so they carry the ember
// animation, the poller and the styles inline: copies of ui/*.js / ui/waiting.css.
const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8').replace(/\r\n/g, '\n')
const theme = read('sablier-themes', 'p7y.html')

describe('Sablier waiting-page themes', () => {
  it('inline exactly the current ui/ files (else: node scripts/build-sablier-themes.mjs)', () => {
    for (const f of ['waiting.css', 'embers.js', 'waiting.js']) expect(theme, f).toContain(read('ui', f).trim())
    expect(theme).not.toContain('src="/assets/')
  })

  it('mark the page and each container state for the poller, and keep a no-JS refresh', () => {
    expect(theme).toContain('data-p7y-waiting')
    expect(theme).toContain('data-states')
    expect(theme).toMatch(/data-state="ready"/)
    expect(theme).toMatch(/data-state="starting"/)
    expect(theme).toContain('<noscript><meta http-equiv="refresh" content="{{ .RefreshFrequency }}"></noscript>')
  })

  it('treat a container stopped by sleep as starting, not as an error', () => {
    expect(theme).toContain('"container exited with code"')
  })

  it('serve old leander-* sandboxes the same page', () => {
    expect(read('sablier-themes', 'leander.html')).toBe(theme)
  })
})
