import { describe, it, expect } from 'vitest'
import { errorPage, errorPageFiles } from '../../services/errorPage'

describe('errorPage', () => {
  it('links the portal to PUBLIC_URL, without its trailing slash', async () => {
    const html = await errorPage({ PUBLIC_URL: 'https://p9m.example.com/' })
    expect(html).toContain('href="https://p9m.example.com" id="portal"')
    expect(html).not.toContain('href="{{P9M_URL}}"')
  })

  it('leaves the placeholder (the page then guesses p9m.<domain>) without PUBLIC_URL or with an odd one', async () => {
    expect(await errorPage({})).toContain('href="{{P9M_URL}}" id="portal"')
    expect(await errorPage({ PUBLIC_URL: 'https://x.example.com/"><script>' })).toContain('href="{{P9M_URL}}" id="portal"')
  })

  it('picks one of the 404 pages at random', async () => {
    const files = await errorPageFiles()
    expect(files.length).toBeGreaterThan(1)
    const first = await errorPage({}, () => 0)
    const last = await errorPage({}, () => 0.999)
    expect(first).not.toBe(last)
  })

  it('every 404 page: loads nothing from elsewhere, has the way out, and keeps still when motion is reduced', async () => {
    const files = await errorPageFiles()
    for (const [i, f] of files.entries()) {
      const html = await errorPage({}, () => (i + 0.5) / files.length)
      expect(html, f).not.toMatch(/https?:\/\/[a-z]/)
      expect(html, f).not.toMatch(/<link\b|@import|url\((?!#)/)
      for (const id of ['where', 'back', 'home', 'portal']) expect(html, `${f} #${id}`).toContain(`id="${id}"`)
      expect(html, f).toContain('href="{{P9M_URL}}" id="portal"')
      expect(html, f).toContain('prefers-reduced-motion: reduce')
    }
  })
})
