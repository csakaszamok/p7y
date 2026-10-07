import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
process.env.SSH_KEYS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-sshroutes-')), 'k.json')
vi.mock('../../services/sandboxSsh', () => ({ refreshOwnerSandboxes: vi.fn() }))
vi.mock('../../services/tokens', () => ({
  resolveToken: vi.fn((t: string) => t === 'p7y_scoped' ? { owner: 'alice@example.com', sandbox: 'p7y-shop' } : t === 'p7y_alice' ? { owner: 'alice@example.com', sandbox: null } : null),
}))

const { default: list } = await import('../../routes/ssh-keys/GET')
const { default: add } = await import('../../routes/ssh-keys/POST')
const { default: del } = await import('../../routes/ssh-keys/[id]/DELETE')
const { refreshOwnerSandboxes } = await import('../../services/sandboxSsh')

const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILQbLq+klAOn7bvdZ+bf7t83dWYc3AfKM/YVFsjF6tLa test@p7y'
const req = (method: string, p: string, token: string | null, body?: unknown) => new Request(`http://localhost${p}`, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
})

describe('/ssh-keys', () => {
  beforeEach(() => { fs.rmSync(process.env.SSH_KEYS_FILE!, { force: true }); vi.mocked(refreshOwnerSandboxes).mockClear() })

  it("adds, lists and deletes the caller's own keys, refreshing that owner's sandboxes", async () => {
    const res = await add(req('POST', '/ssh-keys', 'p7y_alice', { key: KEY, name: 'laptop' }))
    expect(res.status).toBe(201)
    const created = await res.json()
    expect(created).toMatchObject({ name: 'laptop', type: 'ssh-ed25519', fingerprint: 'SHA256:U+jnkCtA+IdjCA4MWWszk3VnBbSII8CpK7D8bzNUWXU' })
    expect(refreshOwnerSandboxes).toHaveBeenCalledWith('alice@example.com')
    expect(await (await list(req('GET', '/ssh-keys', 'p7y_alice'))).json()).toHaveLength(1)
    expect(await (await list(req('GET', '/ssh-keys', 'admin-secret'))).json()).toEqual([]) // the admin has keys of its own
    expect((await del(req('DELETE', `/ssh-keys/${created.id}`, 'admin-secret'))).status).toBe(404) // not the admin's
    const d = await del(req('DELETE', `/ssh-keys/${created.id}`, 'p7y_alice'))
    expect(await d.json()).toEqual({ deleted: created.id })
    expect(refreshOwnerSandboxes).toHaveBeenCalledTimes(2)
  })

  it('answers 400 / 409 with the reason', async () => {
    const bad = await add(req('POST', '/ssh-keys', 'p7y_alice', { key: 'ssh-dss AAAA' }))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe('unsupported key type ssh-dss: use ssh-ed25519, ssh-rsa or ecdsa')
    await add(req('POST', '/ssh-keys', 'p7y_alice', { key: KEY }))
    const dup = await add(req('POST', '/ssh-keys', 'p7y_alice', { key: KEY }))
    expect(dup.status).toBe(409)
    expect((await add(req('POST', '/ssh-keys', 'p7y_alice', { key: 42 }))).status).toBe(400)
  })

  it('needs a login, and a token limited to one sandbox cannot manage keys', async () => {
    expect((await list(req('GET', '/ssh-keys', null))).status).toBe(401)
    expect((await list(req('GET', '/ssh-keys', 'p7y_scoped'))).status).toBe(403)
    expect((await add(req('POST', '/ssh-keys', 'p7y_scoped', { key: KEY }))).status).toBe(403)
  })
})
