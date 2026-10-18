import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ogImageOf, imageKind, refreshImages, imageOf, type Fetched } from '../../../services/hub/images'
import { appImagePath } from '../../../services/hub/apps'
import type { HubEntry } from '../../../services/hub/list'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2])

describe('appImagePath', () => {
  it('is a path inside the app only', () => {
    expect(appImagePath('/shot.png')).toBe('/shot.png')
    expect(appImagePath('/a b.png')).toBeNull()
    expect(appImagePath('/a\\b.png')).toBeNull()
    expect(appImagePath('shot.png')).toBeNull()
    expect(appImagePath(undefined)).toBeNull()
  })
})

describe('ogImageOf', () => {
  const host = 'shop-web.example.com'
  it('reads og:image in either attribute order, relative or on the app’s own host', () => {
    expect(ogImageOf('<meta property="og:image" content="/static/og.png">', host)).toBe('/static/og.png')
    expect(ogImageOf("<meta content='https://shop-web.example.com/a.jpg?v=2' property='og:image' />", host)).toBe('/a.jpg?v=2')
    expect(ogImageOf('<meta property="og:image" content="img/og.png">', host)).toBe('/img/og.png')
    // Valid HTML without quotes (minifiers write it so)
    expect(ogImageOf('<meta property=og:image content=/og.png>', host)).toBe('/og.png')
  })
  it('ignores another host, and pages without one', () => {
    expect(ogImageOf('<meta property="og:image" content="https://cdn.example.net/a.png">', host)).toBeNull()
    expect(ogImageOf('<meta property="og:image" content="//cdn.example.net/a.png">', host)).toBeNull()
    expect(ogImageOf('<title>no image</title>', host)).toBeNull()
  })
})

describe('imageKind', () => {
  it('knows PNG, JPEG, WebP and GIF by their bytes; not SVG or HTML', () => {
    expect(imageKind(PNG)).toBe('image/png')
    expect(imageKind(JPEG)).toBe('image/jpeg')
    expect(imageKind(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))).toBe('image/webp')
    expect(imageKind(Buffer.from('GIF89a', 'latin1'))).toBe('image/gif')
    expect(imageKind(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(imageKind(Buffer.from('<html>'))).toBeNull()
  })
})

const entry = (extra: Partial<HubEntry> = {}): HubEntry => ({
  id: 'shop-web.example.com', url: 'https://shop-web.example.com', title: 'Shop', description: '', service: 'web', port: 8080, image: null,
  owner: 'anna@example.com', owner_name: null, sandbox: 'p7y-shop', status: 'running', updated_at: '2026-10-20T10:00:00.000Z', ...extra,
})
const page = (html: string): Fetched => ({ status: 200, body: Buffer.from(html) })
const png: Fetched = { status: 200, body: PNG }

describe('refreshImages', () => {
  const setup = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubimg-'))
    let clock = Date.parse('2026-10-20T10:00:00Z')
    const asked: string[] = []
    const routes: Record<string, Fetched> = {}
    const deps = {
      dir, now: () => clock,
      get: async (sandbox: string, port: number, p: string) => { asked.push(`${sandbox}:${port}${p}`); return routes[p] ?? { status: 404, body: Buffer.alloc(0) } },
    }
    return { dir, deps, asked, routes, tick: (ms: number) => { clock += ms } }
  }

  it('fetches the labelled image through the sandbox and stores it', async () => {
    const { deps, asked, routes } = setup()
    routes['/shot.png'] = png
    await refreshImages([entry({ image: '/shot.png' })], deps)
    expect(asked).toEqual(['p7y-shop:8080/shot.png'])
    const img = imageOf('shop-web.example.com', deps)
    expect(img?.type).toBe('image/png')
    expect(fs.readFileSync(img!.file)).toEqual(PNG)
  })
  it('without a label, takes og:image from the app’s page', async () => {
    const { deps, asked, routes } = setup()
    routes['/'] = page('<meta property="og:image" content="/og.jpg">')
    routes['/og.jpg'] = { status: 200, body: JPEG }
    await refreshImages([entry()], deps)
    expect(asked).toEqual(['p7y-shop:8080/', 'p7y-shop:8080/og.jpg'])
    expect(imageOf('shop-web.example.com', deps)?.type).toBe('image/jpeg')
  })
  it('never asks an app that is not running (it would wake it), and keeps its last image', async () => {
    const { deps, asked, routes } = setup()
    routes['/shot.png'] = png
    await refreshImages([entry({ image: '/shot.png' })], deps)
    asked.length = 0
    await refreshImages([entry({ image: '/shot.png', status: 'asleep' })], deps)
    expect(asked).toEqual([])
    expect(imageOf('shop-web.example.com', deps)).not.toBeNull()
  })
  it('refreshes once a day, at once when the label changes, and retries a failure after an hour', async () => {
    const { deps, asked, routes, tick } = setup()
    routes['/shot.png'] = png
    await refreshImages([entry({ image: '/shot.png' })], deps)
    await refreshImages([entry({ image: '/shot.png' })], deps)
    expect(asked).toHaveLength(1)
    routes['/new.png'] = png
    await refreshImages([entry({ image: '/new.png' })], deps)
    expect(asked).toHaveLength(2)
    await refreshImages([entry({ image: '/missing.png' })], deps)
    expect(asked).toHaveLength(3)
    tick(10 * 60_000)
    await refreshImages([entry({ image: '/missing.png' })], deps)
    expect(asked).toHaveLength(3)
    tick(60 * 60_000)
    await refreshImages([entry({ image: '/missing.png' })], deps)
    expect(asked).toHaveLength(4)
    tick(25 * 3600_000)
    routes['/missing.png'] = png
    await refreshImages([entry({ image: '/missing.png' })], deps)
    expect(imageOf('shop-web.example.com', deps)).not.toBeNull()
  })
  it('refuses what is not an image or too large, and keeps the image it had', async () => {
    const { deps, routes, tick } = setup()
    routes['/shot.png'] = png
    await refreshImages([entry({ image: '/shot.png' })], deps)
    const before = imageOf('shop-web.example.com', deps)!.version
    tick(25 * 3600_000)
    routes['/shot.png'] = page('<html>not an image</html>')
    await refreshImages([entry({ image: '/shot.png' })], deps)
    expect(imageOf('shop-web.example.com', deps)!.version).toBe(before)
    tick(25 * 3600_000)
    routes['/shot.png'] = { status: 200, body: Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]) }
    await refreshImages([entry({ image: '/shot.png' })], deps)
    expect(imageOf('shop-web.example.com', deps)!.version).toBe(before)
  })
})
