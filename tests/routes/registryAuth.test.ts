import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
vi.mock('../../services/tokens', () => ({ resolveToken: vi.fn((t: string) => t === 'p7y_scoped' ? { owner: 'alice', sandbox: 'p7y-shop' } : t === 'p7y_alice' ? { owner: 'alice', sandbox: null } : null) }))
vi.mock('../../services/registryScans', () => ({ publicPullAllowed: vi.fn(async (r: string) => r !== 'shop/unscanned') }))
vi.mock('../../services/sandbox', () => ({ sandboxService: { listSandboxes: vi.fn(async () => [{ name: 'p7y-shop', owner: 'alice' }]) } }))
vi.mock('../../services/registryAuth', async orig => ({ ...(await orig<object>()), verifyPassword: vi.fn(async (pw: string) => pw === 'regpw') }))
vi.mock('../../services/registryPasswords', () => ({ registryHashOf: vi.fn((user: string) => (user === 'shop' ? 'salt:hash' : null)) }))
const { default: get } = await import('../../routes/v2/auth/GET')
const payload = async (res: Response) => JSON.parse(Buffer.from((await res.json()).token.split('.')[1], 'base64url').toString())
const req = (scope: string, auth?: string) => new Request(`http://localhost/v2/auth?service=registry.lvh.me&scope=${encodeURIComponent(scope)}`, { headers: auth ? { Authorization: `Basic ${Buffer.from(auth).toString('base64')}` } : {} })

describe('GET /v2/auth', () => {
  it('a scoped p7y token pushes its sandbox\'s repos, whatever the user name', async () => {
    expect((await payload(await get(req('repository:shop/todo:pull,push', 'whatever:p7y_scoped')))).access).toEqual([{ type: 'repository', name: 'shop/todo', actions: ['pull', 'push'] }])
  })
  it('a personal token pushes the owner\'s sandboxes\' repos', async () => {
    expect((await payload(await get(req('repository:shop/todo:push', 'alice:p7y_alice')))).access).toEqual([{ type: 'repository', name: 'shop/todo', actions: ['push'] }])
  })
  it('the registry password still works', async () => {
    expect((await payload(await get(req('repository:shop/todo:push', 'shop:regpw')))).access).toEqual([{ type: 'repository', name: 'shop/todo', actions: ['push'] }])
  })
  it('anonymous gets a pull-only token; a wrong password or token is 401', async () => {
    expect((await payload(await get(req('repository:shop/todo:pull,push')))).access).toEqual([{ type: 'repository', name: 'shop/todo', actions: ['pull'] }])
    expect((await get(req('repository:shop/todo:pull', 'shop:wrong'))).status).toBe(401)
    expect((await get(req('repository:shop/todo:pull', 'x:p7y_unknown'))).status).toBe(401)
  })
})

describe('GET /v2/auth, review fixes', () => {
  it('anonymous pull is refused for a repo the registry has versions of that were never scanned', async () => {
    expect((await payload(await get(req('repository:shop/unscanned:pull')))).access).toEqual([])
  })
})
