import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
vi.mock('../../../services/sandbox', () => ({ sandboxService: { getSandbox: vi.fn(async (n: string) => {
  if (n === 'p9m-a') return { name: n, owner: 'u@example.com', status: 'running' }
  if (n === 'p9m-b') return { name: n, owner: 'other@example.com', status: 'running' }
  if (n === 'p9m-deep') return { name: n, owner: 'u@example.com', status: 'deep_sleep' }
  throw new Error(`Sandbox not found: ${n}`)
}) } }))
vi.mock('../../../services/tokens', () => ({
  resolveToken: vi.fn((t: string) => t === 'p9m_u' ? { owner: 'u@example.com', sandbox: null } : t === 'p9m_scoped' ? { owner: 'u@example.com', sandbox: 'p9m-a' } : null),
}))
vi.mock('../../../services/dockerAccess', () => ({ regenerateCerts: vi.fn(async () => {}), dockerAccessState: vi.fn(() => 'ready'), dockerHostName: vi.fn(() => 'a-docker.lvh.me') }))
const { regenerateCerts } = await import('../../../services/dockerAccess')
const { default: post } = await import('../../../routes/sandboxes/[name]/docker-keys/POST')
const req = (n: string, t?: string) => new Request(`http://localhost/sandboxes/${n}/docker-keys`, { method: 'POST', headers: t ? { Authorization: `Bearer ${t}` } : {} })

describe('POST /sandboxes/:name/docker-keys', () => {
  it('regenerates for the owner and the admin', async () => {
    for (const t of ['p9m_u', 'admin-secret']) {
      const res = await post(req('p9m-a', t))
      expect(res.status, t).toBe(200)
      expect(await res.json()).toEqual({ name: 'p9m-a', docker_access: { host: 'a-docker.lvh.me', state: 'ready' } })
    }
    expect(regenerateCerts).toHaveBeenCalledWith('p9m-a', undefined)
  })
  it('a token scoped to the sandbox may not (403); no sign-in 401; someone else\'s 404', async () => {
    expect((await post(req('p9m-a', 'p9m_scoped'))).status).toBe(403)
    expect((await post(req('p9m-a'))).status).toBe(401)
    expect((await post(req('p9m-b', 'p9m_u'))).status).toBe(404)
  })
})

describe('POST /sandboxes/:name/docker-keys, review fixes', () => {
  it('a restart that fails is reported: the certificates are new, the sandbox needs a restart', async () => {
    vi.mocked(regenerateCerts).mockRejectedValueOnce(new Error('compose start failed'))
    const res = await post(req('p9m-a', 'p9m_u'))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('new certificates are in place, but the restart failed (compose start failed): restart the sandbox')
  })
  it('a sandbox in deep sleep gets its certificates without a restart (they load when it wakes)', async () => {
    vi.mocked(regenerateCerts).mockClear()
    expect((await post(req('p9m-deep', 'p9m_u'))).status).toBe(200)
    const restart = vi.mocked(regenerateCerts).mock.calls[0][1]!.restart!
    await expect(restart('p9m-deep')).resolves.toBeUndefined()
  })
})
