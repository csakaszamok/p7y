import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
vi.mock('../../../services/tokens', () => ({ resolveToken: vi.fn((t: string) => t === 'p9m_user' ? { owner: 'u@example.com', sandbox: null } : null) }))
const sandboxes: Record<string, { name: string; owner: string; status: string }> = {
  'p9m-mine': { name: 'p9m-mine', owner: 'u@example.com', status: 'running' },
  'p9m-sleepy': { name: 'p9m-sleepy', owner: 'u@example.com', status: 'exited' },
  'p9m-other': { name: 'p9m-other', owner: 'o@example.com', status: 'running' },
}
vi.mock('../../../services/sandbox', () => ({ sandboxService: { getSandbox: vi.fn(async (n: string) => { if (!sandboxes[n]) throw new Error(`Sandbox not found: ${n}`); return sandboxes[n] }) } }))
const files = {
  list: vi.fn(async () => [{ name: 'a.txt', type: 'file', size: 5, mtime: '2026-10-10T00:00:00.000Z' }]),
  download: vi.fn(async (_n: string, p: string) => p.endsWith('src')
    ? { kind: 'dir', size: null, body: (async function* () { yield new Uint8Array([1, 2]) })() }
    : { kind: 'file', size: 5, body: (async function* () { yield Buffer.from('hello') })() }),
  readText: vi.fn(async () => 'hello'),
  write: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  remove: vi.fn(async (_n: string, p: string) => { if (p === '/root') throw new Error('/root itself cannot be removed') }),
}
vi.mock('../../../services/sandboxFiles', async (orig) => ({ ...(await orig<object>()), sandboxFiles: files }))
const vols = [{ name: 'shop_db', path: '/var/lib/docker/volumes/shop_db/_data', project: 'shop', containers: [{ name: 'shop-db-1', service: 'db', running: true, mount: '/var/lib/postgresql/data' }] }]
const sandboxVolumes = vi.fn(async () => vols)
vi.mock('../../../services/sandboxVolumes', () => ({ sandboxVolumes }))

const list = (await import('../../../routes/sandboxes/[name]/files/GET')).default
const del = (await import('../../../routes/sandboxes/[name]/files/DELETE')).default
const mkdir = (await import('../../../routes/sandboxes/[name]/files/mkdir/POST')).default
const download = (await import('../../../routes/sandboxes/[name]/files/content/GET')).default
const upload = (await import('../../../routes/sandboxes/[name]/files/content/PUT')).default
const text = (await import('../../../routes/sandboxes/[name]/files/text/GET')).default
const volumes = (await import('../../../routes/sandboxes/[name]/volumes/GET')).default

const req = (url: string, init: RequestInit = {}, token = 'p9m_user') => new Request(`http://localhost${url}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })

beforeEach(() => { vi.unstubAllEnvs(); vi.stubEnv('ADMIN_TOKEN', 'admin-secret'); for (const f of Object.values(files)) f.mockClear() })

describe('GET /sandboxes/:name/files', () => {
  it('lists a folder, /root when no path is given', async () => {
    const res = await list(req('/sandboxes/p9m-mine/files'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ path: '/root', roots: ['/root', '/home', '/srv', '/opt'], max_upload: 100 * 1024 ** 2, entries: [{ name: 'a.txt', type: 'file', size: 5, mtime: '2026-10-10T00:00:00.000Z' }] })
    expect(files.list).toHaveBeenCalledWith('p9m-mine', '/root')
  })
  it('refuses a path outside the four folders (400), another owner (404), no token (401)', async () => {
    expect((await list(req('/sandboxes/p9m-mine/files?path=/etc'))).status).toBe(400)
    expect((await list(req('/sandboxes/p9m-other/files'))).status).toBe(404)
    expect((await list(new Request('http://localhost/sandboxes/p9m-mine/files'))).status).toBe(401)
    expect(files.list).not.toHaveBeenCalled()
  })
  it('a sandbox that is not running: 409 with reason not_running', async () => {
    const res = await list(req('/sandboxes/p9m-sleepy/files'))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'not_running' })
  })
  it('a missing folder is 404', async () => {
    files.list.mockRejectedValueOnce(new Error('No such folder: /root/x'))
    expect((await list(req('/sandboxes/p9m-mine/files?path=/root/x'))).status).toBe(404)
  })
})

describe('downloads', () => {
  it('a file: its bytes, as an attachment with its name', async () => {
    const res = await download(req('/sandboxes/p9m-mine/files/content?path=/root/a.txt'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="a.txt"')
    expect(res.headers.get('content-length')).toBe('5')
    expect(await res.text()).toBe('hello')
  })
  it('a folder: a tar named after it', async () => {
    const res = await download(req('/sandboxes/p9m-mine/files/content?path=/root/src'))
    expect(res.headers.get('content-type')).toBe('application/x-tar')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="src.tar"')
  })
  it('a text file for an agent (MCP): JSON with the text', async () => {
    expect(await (await text(req('/sandboxes/p9m-mine/files/text?path=/root/a.txt'))).json()).toEqual({ path: '/root/a.txt', text: 'hello' })
    files.readText.mockRejectedValueOnce(new Error('Not a text file: /root/b'))
    expect((await text(req('/sandboxes/p9m-mine/files/text?path=/root/b'))).status).toBe(400)
  })
})

describe('changes', () => {
  it('uploads the body to the path', async () => {
    const res = await upload(req('/sandboxes/p9m-mine/files/content?path=/root/notes.md', { method: 'PUT', body: '# hi' }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ path: '/root/notes.md', size: 4 })
    expect(files.write).toHaveBeenCalledWith('p9m-mine', '/root/notes.md', Buffer.from('# hi'))
  })
  it('refuses an upload over FILES_MAX_UPLOAD with 413', async () => {
    vi.stubEnv('FILES_MAX_UPLOAD', '1k')
    const res = await upload(req('/sandboxes/p9m-mine/files/content?path=/root/big', { method: 'PUT', body: 'x'.repeat(2000) }))
    expect(res.status).toBe(413)
    expect(files.write).not.toHaveBeenCalled()
  })
  it('makes a folder; removes a file or folder, not the four folders themselves', async () => {
    expect((await mkdir(req('/sandboxes/p9m-mine/files/mkdir', { method: 'POST', body: JSON.stringify({ path: '/srv/data' }), headers: { 'Content-Type': 'application/json' } }))).status).toBe(201)
    expect(files.mkdir).toHaveBeenCalledWith('p9m-mine', '/srv/data')
    expect((await del(req('/sandboxes/p9m-mine/files?path=/root/a.txt', { method: 'DELETE' }))).status).toBe(200)
    expect((await del(req('/sandboxes/p9m-mine/files?path=/root', { method: 'DELETE' }))).status).toBe(400)
    expect((await del(req('/sandboxes/p9m-mine/files', { method: 'DELETE' }))).status).toBe(400) // no path: nothing is removed by default
  })
})

describe('GET /sandboxes/:name/volumes', () => {
  it("the volumes of the sandbox's own Docker, with the containers that use them", async () => {
    const res = await volumes(req('/sandboxes/p9m-mine/volumes'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ volumes: vols })
    expect(sandboxVolumes).toHaveBeenCalledWith('p9m-mine')
  })
  it('another owner (404), a sandbox that is not running (409)', async () => {
    expect((await volumes(req('/sandboxes/p9m-other/volumes'))).status).toBe(404)
    expect((await volumes(req('/sandboxes/p9m-sleepy/volumes'))).status).toBe(409)
  })
  it("just woken, its own Docker not answering yet: 409 with reason docker_starting, not the socket's error", async () => {
    sandboxVolumes.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED 10.10.0.38:2376'), { code: 'ECONNREFUSED' }))
    const res = await volumes(req('/sandboxes/p9m-mine/volumes'))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toMatchObject({ reason: 'docker_starting' })
    expect(body.error).not.toMatch(/ECONNREFUSED|10\.10/)
  })
  it("a volume's files go through the Files routes", async () => {
    const res = await list(req('/sandboxes/p9m-mine/files?path=/var/lib/docker/volumes/shop_db/_data'))
    expect(res.status).toBe(200)
    expect(files.list).toHaveBeenCalledWith('p9m-mine', '/var/lib/docker/volumes/shop_db/_data')
    expect((await list(req('/sandboxes/p9m-mine/files?path=/var/lib/docker/image'))).status).toBe(400)
  })
})
