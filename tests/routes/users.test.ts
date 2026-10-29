import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
vi.stubEnv('SESSION_SECRET', 'test-secret')
vi.mock('../../services/sandbox', () => ({
  sandboxService: {
    listSandboxStates: vi.fn(async () => [
      { name: 'p9m-shop', owner: 'anna@example.com', status: 'running' },
      { name: 'p9m-blog', owner: 'anna@example.com', status: 'exited' },
      { name: 'p9m-old', owner: 'carl@example.com', status: 'deep_sleep' },
    ]),
  },
}))
const { recordSignIn, recordSandboxCreated, _resetSeen } = await import('../../services/userStats')
const { createToken, resolveToken } = await import('../../services/tokens')
const list = (await import('../../routes/users/GET')).default
const del = (await import('../../routes/users/[sub]/DELETE')).default

const admin = { Authorization: 'Bearer admin-secret' }
const asUser = () => ({ authorization: `Bearer ${createToken('anna@example.com', 'test', '30d').token}` })
const get = (headers: Record<string, string>) => list(new Request('http://localhost/users', { headers }))
const remove = (sub: string, headers: Record<string, string>) =>
  del(new Request(`http://localhost/users/${encodeURIComponent(sub)}`, { method: 'DELETE', headers: { origin: 'http://localhost', host: 'localhost', ...headers } }))

beforeEach(() => {
  vi.stubEnv('USER_STATS_FILE', path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'users-')), 'user-stats.json'))
  _resetSeen()
})

describe('GET /users', () => {
  it('the admin: every account with its stats, its sandboxes now and its last API use', async () => {
    recordSignIn('anna@example.com', new Date('2026-10-01T10:00:00Z'))
    recordSandboxCreated('anna@example.com', new Date('2026-10-02T10:00:00Z'))
    recordSignIn('bob@example.com', new Date('2026-10-03T10:00:00Z'))
    const { token } = createToken('anna@example.com', 'laptop', '30d')
    resolveToken(token, new Date('2026-10-04T10:00:00Z'))
    const res = await get(admin)
    expect(res.status).toBe(200)
    const users = (await res.json()).users
    expect(users.map((u: { sub: string }) => u.sub)).toEqual(['bob@example.com', 'anna@example.com', 'carl@example.com'])
    expect(users[1]).toMatchObject({ sign_ins: 1, sandboxes_created: 1, sandboxes_now: 2, last_api_use: '2026-10-04T10:00:00.000Z' })
    expect(users[0]).toMatchObject({ sign_ins: 1, sandboxes_created: 0, sandboxes_now: 0, last_api_use: null })
    // Owns a sandbox from before the stats were kept: no dates
    expect(users[2]).toMatchObject({ sub: 'carl@example.com', first_seen: null, last_seen: null, sign_ins: 0, sandboxes_now: 1 })
  })
  it('only the admin', async () => {
    expect((await get(asUser())).status).toBe(403)
    expect((await get({})).status).toBe(401)
  })
})

describe('DELETE /users/:sub', () => {
  it('the admin deletes a row; an unknown one is 404', async () => {
    recordSignIn('bob@example.com')
    expect((await remove('bob@example.com', admin)).status).toBe(200)
    expect((await remove('bob@example.com', admin)).status).toBe(404)
  })
  it('only the admin', async () => {
    recordSignIn('bob@example.com')
    expect((await remove('bob@example.com', asUser())).status).toBe(403)
  })
})
