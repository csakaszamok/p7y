import type { HubEntry } from './list'

const MAX_ITEMS = 50
const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!))
const newest = (entries: HubEntry[]) => [...entries].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, MAX_ITEMS)
const owner = (e: HubEntry) => e.owner_name ?? e.owner

/** RSS 2.0: one item per published app; guid = its id, so a reader shows an app as new only once. */
export function rssFeed(entries: HubEntry[], hub: { url: string; title: string }): string {
  const items = newest(entries).map(e => `<item><title>${xml(e.title)}</title><link>${xml(e.url)}</link>` +
    `<description>${xml(e.description)}</description><author>${xml(owner(e))}</author>` +
    `<guid isPermaLink="false">${xml(e.id)}</guid><pubDate>${new Date(e.updated_at).toUTCString()}</pubDate></item>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xml(hub.title)}</title>` +
    `<link>${xml(hub.url)}</link><description>Apps published on the ${xml(hub.title)} Hub</description>${items}</channel></rss>`
}

/** JSON Feed 1.1, the same items. */
export function jsonFeed(entries: HubEntry[], hub: { url: string; title: string }): string {
  return JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: hub.title,
    home_page_url: hub.url,
    items: newest(entries).map(e => ({ id: e.id, url: e.url, title: e.title, content_text: e.description, date_modified: e.updated_at, authors: [{ name: owner(e) }] })),
  })
}
