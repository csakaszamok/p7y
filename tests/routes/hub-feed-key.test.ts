import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import handler from '../../routes/hub/feed-key/POST'
import { feedKeyValid } from '../../services/hub/feedKey'

beforeEach(() => { Object.assign(process.env, {
  ADMIN_TOKEN: 'admintoken', HOST_DOMAIN: 'example.com', PUBLIC_URL: 'https://p9m.example.com',
  HUB_FEED_KEY_FILE: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fk-')), 'key'),
}) })
const post = (auth?: string) => handler(new Request('https://p9m.example.com/hub/feed-key', { method: 'POST', headers: auth ? { authorization: `Bearer ${auth}` } : {} }))

describe('POST /hub/feed-key', () => {
  it('is 404 while the Hub is off', async () => {
    process.env.HUB_ENABLED = 'false'
    expect((await post('admintoken')).status).toBe(404)
  })
  it('gives the admin a new feed link that works', async () => {
    process.env.HUB_ENABLED = 'true'
    const { url } = await (await post('admintoken')).json()
    expect(url).toMatch(/^https:\/\/hub\.example\.com\/feed\.xml\?key=hubf_/)
    expect(feedKeyValid(new URL(url).searchParams.get('key'))).toBe(true)
  })
  it('refuses others', async () => {
    process.env.HUB_ENABLED = 'true'
    expect((await post()).status).toBe(401)
  })
})
