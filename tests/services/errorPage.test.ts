import { describe, it, expect } from 'vitest'
import { errorPage } from '../../services/errorPage'

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

  it('loads nothing from elsewhere', async () => {
    expect(await errorPage({})).not.toMatch(/salehriaz|http:\/\/[a-z]/)
  })
})
