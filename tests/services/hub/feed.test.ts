import { describe, it, expect } from 'vitest'
import { rssFeed, jsonFeed } from '../../../services/hub/feed'
import type { HubEntry } from '../../../services/hub/list'

const entry = (i: number, extra: Partial<HubEntry> = {}): HubEntry => ({
  id: `app${i}.example.com`, url: `https://app${i}.example.com`, title: `App ${i}`, description: 'd', service: 'web', port: 80, image: null,
  owner: 'anna@example.com', owner_name: 'Anna', sandbox: 'p7y-shop', status: 'running',
  updated_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), last_ran_at: null, last_ran_estimated: false, ...extra,
})
const hub = { url: 'https://hub.example.com', title: 'Example Ltd' }

describe('feeds', () => {
  it('RSS: escaped, guid = app id, newest 50', () => {
    const xml = rssFeed([entry(1, { title: 'A & <B>', updated_at: '2026-12-01T00:00:00.000Z' }), ...Array.from({ length: 60 }, (_, i) => entry(i + 2))], hub)
    expect(xml).toContain('<title>A &amp; &lt;B&gt;</title>')
    expect(xml).toContain('<guid isPermaLink="false">app1.example.com</guid>')
    expect(xml.match(/<item>/g)).toHaveLength(50)
    expect(xml).toContain('<pubDate>')
  })
  it('JSON Feed 1.1 with the same items', () => {
    const f = JSON.parse(jsonFeed([entry(1)], hub))
    expect(f.version).toBe('https://jsonfeed.org/version/1.1')
    expect(f.items[0]).toMatchObject({ id: 'app1.example.com', url: 'https://app1.example.com', title: 'App 1', authors: [{ name: 'Anna' }] })
  })
})
