import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
vi.stubEnv('PUBLIC_URL', 'https://p9m.lvh.me')
vi.stubEnv('HOST_DOMAIN', 'lvh.me')
vi.mock('../../../services/sandbox', () => ({ sandboxService: { getSandbox: vi.fn(async (n: string) => {
  if (n === 'p9m-shop' || n === 'p9m-old' || n === 'p9m-nocerts') return { name: n, owner: 'u@example.com', status: 'running' }
  throw new Error(`Sandbox not found: ${n}`)
}) } }))
vi.mock('../../../services/tokens', () => ({
  resolveToken: vi.fn((t: string) => t === 'p9m_u' ? { owner: 'u@example.com', sandbox: null } : t === 'p9m_scoped' ? { owner: 'u@example.com', sandbox: 'p9m-shop' } : null),
  createToken: vi.fn(() => ({ token: 'p9m_newtokenvalue', info: { id: 'x' } })),
}))
vi.mock('../../../services/dockerAccess', () => ({ dockerAccessState: vi.fn((n: string) => (n === 'p9m-old' ? 'needs-certs' : 'ready')), dockerHostName: vi.fn(() => 'shop-docker.lvh.me') }))
vi.mock('../../../services/agentExport', async orig => {
  const real = await orig<typeof import('../../../services/agentExport')>()
  // the client certificates come from the sandbox dir: stand-ins here
  return { prepareExport: (s: string, o: { docker?: boolean } = {}) => { if (s === 'p9m-nocerts') throw new Error('ENOENT: key.pem'); return real.prepareExport(s, { ...o, readCert: (f: string) => `PEM ${f}` }) } }
})
vi.mock('../../../services/portainerToken', () => ({
  portainerAccess: vi.fn(async (s: { name: string }) => s.name === 'p9m-shop' ? { url: 'https://shop-portainer.lvh.me', token: 'ptr_agent' } : { skipped: 'Portainer is private to the sandbox' }),
}))
const { portainerAccess } = await import('../../../services/portainerToken')
const { createToken } = await import('../../../services/tokens')
const { default: post } = await import('../../../routes/sandboxes/[name]/export/POST')
const req = (n: string, t: string) => new Request(`http://localhost/sandboxes/${n}/export`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'laptop agent', expires_in: '30d' }) })

describe('POST /sandboxes/:name/export', () => {
  it('zips a fresh scoped token, the Docker client certs and a README', async () => {
    const res = await post(req('p9m-shop', 'p9m_u'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="p9m-shop.zip"')
    expect(createToken).toHaveBeenCalledWith('u@example.com', 'laptop agent', '30d', expect.any(Date), 'p9m-shop')
    const text = Buffer.from(await res.arrayBuffer()).toString('latin1')
    // A .p9m folder for the project's folder, kept out of git by its own .gitignore
    for (const f of ['.p9m/.gitignore', '.p9m/p9m.env', '.p9m/docker/ca.pem', '.p9m/docker/cert.pem', '.p9m/docker/key.pem', '.p9m/README.md']) expect(text).toContain(f)
    expect(text).not.toContain('p9m-shop/p9m.env')
    expect(text).toContain('P9M_TOKEN=p9m_newtokenvalue')
    expect(text).toContain('P9M_DOCKER_HOST=tcp://shop-docker.lvh.me:443')
    expect(text).toContain('P9M_REGISTRY=registry.lvh.me')
    expect(text).toContain('docker context create p9m-shop')
    expect(text).toContain('ca=$PWD/.p9m/docker/ca.pem')
    expect(text).toContain('Add `.p9m` to your `.dockerignore`')
    expect(text).toContain('PEM key.pem')
  })
  it('not with a token limited to the sandbox (403); 409 before Docker access is enabled', async () => {
    expect((await post(req('p9m-shop', 'p9m_scoped'))).status).toBe(403)
    const old = await post(req('p9m-old', 'p9m_u'))
    expect(old.status).toBe(409)
    expect((await old.json()).error).toBe('enable Docker access first')
  })
})

describe('POST /sandboxes/:name/export, review fixes', () => {
  it('makes no token when the export cannot be built', async () => {
    vi.mocked(createToken).mockClear()
    const res = await post(req('p9m-nocerts', 'p9m_u'))
    expect(res.status).toBe(500)
    expect(createToken).not.toHaveBeenCalled()
  })
})

const reqWith = (n: string, body: Record<string, unknown>) => new Request(`http://localhost/sandboxes/${n}/export`, { method: 'POST', headers: { Authorization: 'Bearer p9m_u', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('POST /sandboxes/:name/export, without Docker access or as text', () => {
  it('docker: false exports p9m.env and the README only, also before Docker access is enabled', async () => {
    const res = await post(reqWith('p9m-old', { docker: false }))
    expect(res.status).toBe(200)
    const text = Buffer.from(await res.arrayBuffer()).toString('latin1')
    expect(text).toContain('.p9m/p9m.env')
    expect(text).toContain('.p9m/README.md')
    expect(text).not.toContain('docker/key.pem')
    expect(text).not.toContain('P9M_DOCKER_HOST')
  })
  it('format: env gives the p9m.env text, with the Docker address only when Docker access is ready', async () => {
    const ready = await post(reqWith('p9m-shop', { format: 'env' }))
    expect(ready.status).toBe(200)
    expect(ready.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    const env = await ready.text()
    expect(env).toContain('P9M_TOKEN=p9m_newtokenvalue')
    expect(env).toContain('P9M_DOCKER_HOST=tcp://shop-docker.lvh.me:443')
    const old = await (await post(reqWith('p9m-old', { format: 'env' }))).text()
    expect(old).toContain('P9M_SANDBOX=p9m-old')
    expect(old).not.toContain('P9M_DOCKER_HOST')
  })
})

describe('POST /sandboxes/:name/export, Portainer token', () => {
  it('puts a Portainer API token in p9m.env, named after the export', async () => {
    const env = await (await post(reqWith('p9m-shop', { format: 'env', name: 'copied today' }))).text()
    expect(env).toContain('P9M_PORTAINER_URL=https://shop-portainer.lvh.me')
    expect(env).toContain('P9M_PORTAINER_TOKEN=ptr_agent')
    expect(portainerAccess).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'p9m-shop' }), 'p9m: copied today')
    const zipText = Buffer.from(await (await post(req('p9m-shop', 'p9m_u'))).arrayBuffer()).toString('latin1')
    expect(zipText).toContain('P9M_PORTAINER_TOKEN=ptr_agent')
    expect(zipText).toContain('X-API-Key')
  })
  it('exports without it, and says why, when there is no Portainer token', async () => {
    const res = await post(reqWith('p9m-old', { format: 'env' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-p9m-portainer')).toBe('Portainer is private to the sandbox')
    const env = await res.text()
    expect(env).not.toContain('P9M_PORTAINER_TOKEN')
    expect(env).toContain('# Portainer: not included (Portainer is private to the sandbox)')
  })
})

describe('the .p9m folder', () => {
  it('ignores itself in git: its .gitignore is a single *', async () => {
    const { prepareExport } = await import('../../../services/agentExport')
    const files = prepareExport('p9m-shop')('p9m_tok')
    expect(files.find(f => f.path === '.p9m/.gitignore')?.data).toBe('*\n')
    expect(files.every(f => f.path.startsWith('.p9m/'))).toBe(true)
  })
})
