import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
vi.mock('../../../services/sandbox', () => ({ sandboxService: { getSandbox: vi.fn(async (n: string) => {
  if (n === 'p7y-shop') return { name: n, owner: 'u@example.com', status: 'running' }
  if (n === 'p7y-other') return { name: n, owner: 'x@example.com', status: 'running' }
  throw new Error(`Sandbox not found: ${n}`)
}) } }))
vi.mock('../../../services/tokens', () => ({ resolveToken: vi.fn((t: string) => t === 'p7y_scoped' ? { owner: 'u@example.com', sandbox: 'p7y-shop' } : null) }))
vi.mock('../../../services/registryScans', () => ({
  reposOf: vi.fn(() => ['shop/todo']),
  versionsOf: vi.fn(() => [{ digest: 'sha256:a', state: 'flagged', tags: ['2'], pushed_at: 'x', findings: [{ file: 'app/.env', rule: 'env-file', sample: '' }] }]),
  forgetVersion: vi.fn(),
}))
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 202 }))
vi.stubGlobal('fetch', fetchMock)
const S = await import('../../../services/registryScans')
const { default: get } = await import('../../../routes/sandboxes/[name]/registry/GET')
const { default: del } = await import('../../../routes/sandboxes/[name]/registry/[app]/[digest]/DELETE')
const h = { Authorization: 'Bearer p7y_scoped' }

describe('sandbox registry', () => {
  it('lists its repos and versions with scan results', async () => {
    const body = await (await get(new Request('http://localhost/sandboxes/p7y-shop/registry', { headers: h }))).json()
    expect(body.repos).toEqual([{ repo: 'shop/todo', versions: [expect.objectContaining({ digest: 'sha256:a', state: 'flagged' })] }])
    expect(body.registry).toBe('registry.lvh.me')
  })
  it('deletes a version in the registry and forgets it', async () => {
    const res = await del(new Request('http://localhost/sandboxes/p7y-shop/registry/todo/sha256:a', { method: 'DELETE', headers: h }))
    expect(res.status).toBe(200)
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/v2\/shop\/todo\/manifests\/sha256:a$/)
    expect(S.forgetVersion).toHaveBeenCalledWith('shop/todo', 'sha256:a')
  })
  it('404 for an unknown version, and for another sandbox', async () => {
    vi.mocked(S.versionsOf).mockReturnValueOnce([])
    expect((await del(new Request('http://localhost/sandboxes/p7y-shop/registry/nope/sha256:a', { method: 'DELETE', headers: h }))).status).toBe(404)
    expect((await get(new Request('http://localhost/sandboxes/p7y-other/registry', { headers: h }))).status).toBe(404)
  })
})

describe('sandbox registry, review fixes', () => {
  it('deletes a version of a nested repo (shop/team/api), and the platform manifests of an index', async () => {
    vi.mocked(S.versionsOf).mockReturnValue([{ digest: 'sha256:idx', state: 'flagged', tags: ['1'], pushed_at: 'x', findings: [] }] as never)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ manifests: [{ digest: 'sha256:amd64' }, { digest: 'sha256:arm64' }] }))
      return new Response(null, { status: 202 })
    })
    const res = await del(new Request('http://localhost/sandboxes/p7y-shop/registry/team%2Fapi/sha256:idx', { method: 'DELETE', headers: h }))
    expect(res.status).toBe(200)
    const deletes = fetchMock.mock.calls.filter(c => c[1]?.method === 'DELETE').map(c => String(c[0]).replace(/^.*\/v2\//, ''))
    expect(deletes).toEqual(['shop/team/api/manifests/sha256:amd64', 'shop/team/api/manifests/sha256:arm64', 'shop/team/api/manifests/sha256:idx'])
  })
  it('a malformed escape is a 404, not a crash', async () => {
    expect((await del(new Request('http://localhost/sandboxes/p7y-shop/registry/%E0/sha256:a', { method: 'DELETE', headers: h }))).status).toBe(404)
  })
})
