import { describe, it, expect, vi } from 'vitest'
import { Readable } from 'node:stream'
import { generateCertBundle } from '../../services/tls'
import { readTarEntries } from '../../services/tarReader'

const good = generateCertBundle('127.0.0.1', 'p7y-shop', 1024, ['shop-docker.lvh.me'])
const other = generateCertBundle('127.0.0.1', 'p7y-x', 1024)

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
vi.stubEnv('PUBLIC_URL', 'https://p7y.example.com')
vi.mock('../../services/access', () => ({
  getOwnedSandbox: vi.fn(async (_p: unknown, n: string) => { if (n === 'p7y-none') throw new Error('Sandbox not found'); return { name: n, owner: 'admin' } }),
}))
vi.mock('../../services/dockerAccess', () => ({
  dockerAccessState: vi.fn((n: string) => n === 'p7y-off' ? 'needs-certs' : 'ready'),
  dockerHostName: vi.fn((n: string) => `${n.replace(/^p7y-/, '')}-docker.lvh.me`),
}))
vi.mock('../../services/projectLink', async (orig) => ({
  ...(await orig<typeof import('../../services/projectLink')>()),
  readDockerKeys: vi.fn((n: string) => ({ ca_cert: good.caCert, client_cert: good.clientCert, client_key: n === 'p7y-bad' ? other.clientKey : good.clientKey })),
}))
const { default: post } = await import('../../routes/sandboxes/[name]/project-link/POST')
const { default: download } = await import('../../routes/project-dir/[token]/GET')
const ask = (n: string) => post(new Request(`http://localhost/sandboxes/${n}/project-link`, { method: 'POST', headers: { Authorization: 'Bearer admin-secret' } }))
const fetchDir = (url: string) => download(new Request(url.replace('https://p7y.example.com', 'http://localhost')))

async function untar(res: Response): Promise<Record<string, { data: string }>> {
  const out: Record<string, { data: string }> = {}
  await readTarEntries(Readable.from([Buffer.from(await res.arrayBuffer())]), async e => { out[e.path] = { data: String(await e.read()) } }, { gzip: false })
  return out
}

describe('project_dir_link', () => {
  it('a link and the command; the answer holds no key', async () => {
    const res = await ask('p7y-shop')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toMatch(/PRIVATE KEY|BEGIN CERTIFICATE/)
    const body = JSON.parse(text)
    expect(body.url).toMatch(/^https:\/\/p7y\.example\.com\/project-dir\/[A-Za-z0-9_-]{40,}$/)
    expect(body.expires_in).toBe(300)
    expect(body.command).toBe(`curl -sf "${body.url}" | tar -x -C <project folder>`)
    expect(body.context_commands[0]).toBe("docker context rm -f p7y-shop")
    expect(body.context_commands[1]).toContain('docker context create p7y-shop --docker "host=tcp://shop-docker.lvh.me:443,ca=<project folder>/.p7y/docker/ca.pem')
  })

  it('the link gives the .p7y folder once; then 410', async () => {
    const { url } = await (await ask('p7y-shop')).json()
    const res = await fetchDir(url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/x-tar')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const files = await untar(res)
    expect(Object.keys(files).sort()).toEqual(['.p7y/.gitignore', '.p7y/docker/ca.pem', '.p7y/docker/cert.pem', '.p7y/docker/key.pem', '.p7y/p7y.env'])
    expect(files['.p7y/docker/key.pem'].data).toBe(good.clientKey)
    expect(files['.p7y/p7y.env'].data).toBe('P7Y_URL=https://p7y.example.com\nP7Y_SANDBOX=p7y-shop\nP7Y_DOCKER_HOST=tcp://shop-docker.lvh.me:443\n')
    const again = await fetchDir(url)
    expect(again.status).toBe(410)
    expect(await again.text()).toMatch(/expired or was used: ask for a new one/)
  })

  it('Docker access off: 409; not the caller\'s: 404; keys that do not belong together: 500, no link', async () => {
    expect((await ask('p7y-off')).status).toBe(409)
    expect((await ask('p7y-none')).status).toBe(404)
    const bad = await ask('p7y-bad')
    expect(bad.status).toBe(500)
    expect((await bad.json()).error).toMatch(/does not match/)
  })
})
