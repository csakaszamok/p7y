import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
vi.stubEnv('PUBLIC_URL', 'https://p7y.lvh.me')
vi.stubEnv('HOST_DOMAIN', 'lvh.me')
vi.mock('../../../services/sandbox', () => ({ sandboxService: { getSandbox: vi.fn(async (n: string) => {
  if (n === 'p7y-shop' || n === 'p7y-old' || n === 'p7y-nocerts') return { name: n, owner: 'u@example.com', status: 'running' }
  throw new Error(`Sandbox not found: ${n}`)
}) } }))
vi.mock('../../../services/tokens', () => ({
  resolveToken: vi.fn((t: string) => t === 'p7y_u' ? { owner: 'u@example.com', sandbox: null } : t === 'p7y_scoped' ? { owner: 'u@example.com', sandbox: 'p7y-shop' } : null),
  createToken: vi.fn(() => ({ token: 'p7y_newtokenvalue', info: { id: 'x' } })),
}))
vi.mock('../../../services/dockerAccess', () => ({ dockerAccessState: vi.fn((n: string) => (n === 'p7y-old' ? 'needs-certs' : 'ready')), dockerHostName: vi.fn(() => 'shop-docker.lvh.me') }))
vi.mock('../../../services/agentExport', async orig => {
  const real = await orig<typeof import('../../../services/agentExport')>()
  // the client certificates come from the sandbox dir: stand-ins here
  return { prepareExport: (s: string, o: { docker?: boolean } = {}) => { if (s === 'p7y-nocerts') throw new Error('ENOENT: key.pem'); return real.prepareExport(s, { ...o, readCert: (f: string) => `PEM ${f}` }) } }
})
vi.mock('../../../services/portainerToken', () => ({
  portainerAccess: vi.fn(async (s: { name: string }) => s.name === 'p7y-shop' ? { url: 'https://shop-portainer.lvh.me', token: 'ptr_agent' } : { skipped: 'Portainer is private to the sandbox' }),
}))
const { portainerAccess } = await import('../../../services/portainerToken')
const { createToken } = await import('../../../services/tokens')
const { default: post } = await import('../../../routes/sandboxes/[name]/export/POST')
const req = (n: string, t: string) => new Request(`http://localhost/sandboxes/${n}/export`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'laptop agent', expires_in: '30d' }) })

describe('POST /sandboxes/:name/export', () => {
  it('zips a fresh scoped token, the Docker client certs and a README', async () => {
    const res = await post(req('p7y-shop', 'p7y_u'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="p7y-shop.zip"')
    expect(createToken).toHaveBeenCalledWith('u@example.com', 'laptop agent', '30d', expect.any(Date), 'p7y-shop')
    const text = Buffer.from(await res.arrayBuffer()).toString('latin1')
    for (const f of ['p7y-shop/p7y.env', 'p7y-shop/docker/ca.pem', 'p7y-shop/docker/cert.pem', 'p7y-shop/docker/key.pem', 'p7y-shop/README.md']) expect(text).toContain(f)
    expect(text).toContain('P7Y_TOKEN=p7y_newtokenvalue')
    expect(text).toContain('P7Y_DOCKER_HOST=tcp://shop-docker.lvh.me:443')
    expect(text).toContain('P7Y_REGISTRY=registry.lvh.me')
    expect(text).toContain('docker context create p7y-shop')
    expect(text).toContain('PEM key.pem')
  })
  it('not with a token limited to the sandbox (403); 409 before Docker access is enabled', async () => {
    expect((await post(req('p7y-shop', 'p7y_scoped'))).status).toBe(403)
    const old = await post(req('p7y-old', 'p7y_u'))
    expect(old.status).toBe(409)
    expect((await old.json()).error).toBe('enable Docker access first')
  })
})

describe('POST /sandboxes/:name/export, review fixes', () => {
  it('makes no token when the export cannot be built', async () => {
    vi.mocked(createToken).mockClear()
    const res = await post(req('p7y-nocerts', 'p7y_u'))
    expect(res.status).toBe(500)
    expect(createToken).not.toHaveBeenCalled()
  })
})

const reqWith = (n: string, body: Record<string, unknown>) => new Request(`http://localhost/sandboxes/${n}/export`, { method: 'POST', headers: { Authorization: 'Bearer p7y_u', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('POST /sandboxes/:name/export, without Docker access or as text', () => {
  it('docker: false exports p7y.env and the README only, also before Docker access is enabled', async () => {
    const res = await post(reqWith('p7y-old', { docker: false }))
    expect(res.status).toBe(200)
    const text = Buffer.from(await res.arrayBuffer()).toString('latin1')
    expect(text).toContain('p7y-old/p7y.env')
    expect(text).toContain('p7y-old/README.md')
    expect(text).not.toContain('docker/key.pem')
    expect(text).not.toContain('P7Y_DOCKER_HOST')
  })
  it('format: env gives the p7y.env text, with the Docker address only when Docker access is ready', async () => {
    const ready = await post(reqWith('p7y-shop', { format: 'env' }))
    expect(ready.status).toBe(200)
    expect(ready.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    const env = await ready.text()
    expect(env).toContain('P7Y_TOKEN=p7y_newtokenvalue')
    expect(env).toContain('P7Y_DOCKER_HOST=tcp://shop-docker.lvh.me:443')
    const old = await (await post(reqWith('p7y-old', { format: 'env' }))).text()
    expect(old).toContain('P7Y_SANDBOX=p7y-old')
    expect(old).not.toContain('P7Y_DOCKER_HOST')
  })
})

describe('POST /sandboxes/:name/export, Portainer token', () => {
  it('puts a Portainer API token in p7y.env, named after the export', async () => {
    const env = await (await post(reqWith('p7y-shop', { format: 'env', name: 'copied today' }))).text()
    expect(env).toContain('P7Y_PORTAINER_URL=https://shop-portainer.lvh.me')
    expect(env).toContain('P7Y_PORTAINER_TOKEN=ptr_agent')
    expect(portainerAccess).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'p7y-shop' }), 'p7y: copied today')
    const zipText = Buffer.from(await (await post(req('p7y-shop', 'p7y_u'))).arrayBuffer()).toString('latin1')
    expect(zipText).toContain('P7Y_PORTAINER_TOKEN=ptr_agent')
    expect(zipText).toContain('X-API-Key')
  })
  it('exports without it, and says why, when there is no Portainer token', async () => {
    const res = await post(reqWith('p7y-old', { format: 'env' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-p7y-portainer')).toBe('Portainer is private to the sandbox')
    const env = await res.text()
    expect(env).not.toContain('P7Y_PORTAINER_TOKEN')
    expect(env).toContain('# Portainer: not included (Portainer is private to the sandbox)')
  })
})
