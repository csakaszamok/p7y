import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { handleHub } from '../../../services/hub/router'
import { createHubSession } from '../../../services/hub/session'
import { createFeedKey } from '../../../services/hub/feedKey'
import type { HubEntry } from '../../../services/hub/list'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubrouter-'))
beforeEach(() => {
  Object.assign(process.env, {
    HUB_ENABLED: 'true', HOST_DOMAIN: 'example.com', PUBLIC_URL: 'https://p7y.example.com', SESSION_SECRET: 's',
    OIDC_ALLOWED_EMAILS: 'anna@example.com', HUB_ALLOWED_DOMAINS: 'example.com',
    HUB_VOTES_FILE: path.join(dir, 'votes.json'), HUB_FEED_KEY_FILE: path.join(dir, 'key'), HUB_NAMES_FILE: path.join(dir, 'names.json'),
  })
  fs.rmSync(path.join(dir, 'votes.json'), { force: true })
})

const app: HubEntry = { id: 'shop-web.example.com', url: 'https://shop-web.example.com', title: 'Shop', description: '', service: 'web', owner: 'anna@example.com', owner_name: 'Anna', sandbox: 'p7y-shop', status: 'running', updated_at: '2026-10-20T10:00:00.000Z' }
const deps = { entries: async () => [app] }
const as = (sub: string) => ({ cookie: `p7y_hub=${createHubSession(sub, null)}` })
const get = (p: string, headers: Record<string, string> = {}) => handleHub(new Request(`https://hub.example.com${p}`, { headers }), deps)
const send = (method: string, p: string, headers: Record<string, string>) =>
  handleHub(new Request(`https://hub.example.com${p}`, { method, headers: { origin: 'https://hub.example.com', host: 'hub.example.com', ...headers } }), deps)

describe('handleHub', () => {
  it('is 404 everywhere when the Hub is off', async () => {
    process.env.HUB_ENABLED = 'false'
    expect((await get('/', as('peter@example.com'))).status).toBe(404)
  })
  it('sends a visitor to sign in, and serves the page to a viewer', async () => {
    expect((await get('/')).headers.get('location')).toBe('/login')
    const page = await get('/', as('peter@example.com'))
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('/assets/hub.js')
  })
  it('lists apps with votes, whether you voted, and whether it is yours', async () => {
    const r = await (await get('/api/hub', as('peter@example.com'))).json()
    expect(r.apps[0]).toMatchObject({ id: 'shop-web.example.com', votes: 0, voted: false, mine: false })
    expect(r.apps[0]).not.toHaveProperty('sandbox')
    expect((await get('/api/hub')).status).toBe(401)
  })
  it('votes once, takes it back; also for your own app; not for an app that is not on the Hub, not cross-site', async () => {
    expect((await send('PUT', '/api/hub/apps/shop-web.example.com/vote', as('peter@example.com'))).status).toBe(200)
    expect((await (await get('/api/hub', as('eva@example.com'))).json()).apps[0].votes).toBe(1)
    expect((await send('DELETE', '/api/hub/apps/shop-web.example.com/vote', as('peter@example.com'))).status).toBe(200)
    // As a GitHub star: the owner may vote for their own app too
    expect((await send('PUT', '/api/hub/apps/shop-web.example.com/vote', as('anna@example.com'))).status).toBe(200)
    expect((await (await get('/api/hub', as('anna@example.com'))).json()).apps[0]).toMatchObject({ votes: 1, voted: true, mine: true })
    expect((await send('PUT', '/api/hub/apps/nope.example.com/vote', as('peter@example.com'))).status).toBe(404)
    expect((await send('PUT', '/api/hub/apps/shop-web.example.com/vote', { ...as('peter@example.com'), origin: 'https://evil.example' })).status).toBe(403)
  })
  it('serves the feed with the key only', async () => {
    const key = createFeedKey()
    expect((await get(`/feed.xml?key=${key}`)).status).toBe(200)
    expect((await get(`/feed.json?key=${key}`)).headers.get('content-type')).toContain('application/feed+json')
    expect((await get('/feed.xml?key=wrong')).status).toBe(404)
    expect((await get('/feed.xml')).status).toBe(404)
  })
  it('does not expose Purgatory on the Hub host', async () => {
    for (const p of ['/sandboxes', '/mcp', '/swagger', '/swagger.json', '/me', '/overview']) {
      expect((await get(p, as('anna@example.com'))).status).toBe(404)
    }
  })
  it('signs the admin in with the password', async () => {
    process.env.ADMIN_USER = 'admin'; process.env.ADMIN_PASSWORD = 'pw'
    const r = await handleHub(new Request('https://hub.example.com/login', { method: 'POST', headers: { origin: 'https://hub.example.com', host: 'hub.example.com', 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=admin&password=pw' }), deps)
    expect(r.status).toBe(303)
    expect(r.headers.get('set-cookie')).toContain('p7y_hub=')
  })
})
