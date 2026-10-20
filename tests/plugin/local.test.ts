import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { generateCertBundle } from '../../services/tls'

const HELPER = path.join(__dirname, '..', '..', 'plugins', 'p7y', 'mcp', 'p7y-local.mjs')
const good = generateCertBundle('127.0.0.1', 'p7y-shop', 1024, ['shop-docker.example.com'])
const other = generateCertBundle('127.0.0.1', 'p7y-x', 1024)

// A Purgatory: the sandbox (keys only with include_keys=true) and who is asking
let server: http.Server
let base = ''
const asked: string[] = []
beforeAll(async () => {
  server = http.createServer((req, res) => {
    asked.push(req.url ?? '')
    if (req.headers.authorization !== 'Bearer p7y_tok') { res.writeHead(401).end('{}'); return }
    const u = new URL(req.url ?? '/', 'http://x')
    if (u.pathname === '/me') { res.end(JSON.stringify({ sub: 'ann@example.com', url: 'https://p7y.example.com' })); return }
    const m = /^\/sandboxes\/(p7y-[a-z]+)$/.exec(u.pathname)
    if (!m) { res.writeHead(404).end('{}'); return }
    const keys = u.searchParams.get('include_keys') === 'true'
    const mismatched = m[1] === 'p7y-bad'
    res.end(JSON.stringify({
      name: m[1], status: 'running', docker_access: { host: 'shop-docker.example.com', state: 'ready' },
      ...(keys ? { ca_cert: good.caCert, client_cert: good.clientCert, client_key: mismatched ? other.clientKey : good.clientKey } : {}),
    }))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server.close() })

/** A fake docker: records its arguments, one call per line */
function fakeDocker(dir: string): { bin: string; log: string } {
  const log = path.join(dir, 'docker.log')
  const js = path.join(dir, 'docker.js')
  fs.writeFileSync(js, `require('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n')`)
  if (process.platform === 'win32') {
    const bin = path.join(dir, 'docker.cmd')
    fs.writeFileSync(bin, `@"${process.execPath}" "${js}" %*\r\n`)
    return { bin, log }
  }
  const bin = path.join(dir, 'docker')
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`, { mode: 0o755 })
  return { bin, log }
}

/** Talk MCP over stdio to the helper: initialize, then the calls; resolves with each call's result */
async function talk(env: Record<string, string>, calls: Array<{ method: string; params?: unknown }>): Promise<unknown[]> {
  const child = spawn(process.execPath, [HELPER], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
  const out: Record<number, unknown> = {}
  let buf = ''
  const done = new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1)
        if (!line.trim()) continue
        const msg = JSON.parse(line) as { id: number; result?: unknown; error?: unknown }
        out[msg.id] = msg.result ?? msg.error
        if (Object.keys(out).length === calls.length + 1) resolve()
      }
    })
    child.on('error', reject)
    setTimeout(() => reject(new Error('the helper did not answer')), 20_000)
  })
  const send = (m: object) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
  send({ id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
  send({ method: 'notifications/initialized' })
  calls.forEach((c, k) => send({ id: k + 1, ...c }))
  await done
  child.kill()
  return calls.map((_, k) => out[k + 1])
}
const textOf = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0].text)

describe('p7y-local: setup_project_dir', () => {
  it('lists its one tool', async () => {
    const [list] = await talk({ P7Y_URL: base, P7Y_TOKEN: 'p7y_tok' }, [{ method: 'tools/list' }])
    expect((list as { tools: Array<{ name: string }> }).tools.map(t => t.name)).toEqual(['setup_project_dir'])
  })

  it('writes the .p7y folder itself, checks the keys, sets up the docker context; the answer holds no key', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-local-'))
    const project = path.join(dir, 'project')
    fs.mkdirSync(project)
    const docker = fakeDocker(dir)
    const [res] = await talk({ P7Y_URL: base, P7Y_TOKEN: 'p7y_tok', P7Y_DOCKER: docker.bin },
      [{ method: 'tools/call', params: { name: 'setup_project_dir', arguments: { sandbox: 'p7y-shop', project_dir: project } } }])
    const text = textOf(res)
    expect(text).not.toMatch(/PRIVATE KEY|BEGIN CERTIFICATE/)
    expect(text).not.toContain(good.clientKey.split('\n')[1])
    const r = JSON.parse(text)
    expect(r).toMatchObject({ ok: true, sandbox: 'p7y-shop', context: 'p7y-shop', keys: 'valid: the key matches the certificate, the CA signed it' })
    expect(r.fingerprint).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/)
    const p7y = path.join(project, '.p7y')
    expect(fs.readFileSync(path.join(p7y, '.gitignore'), 'utf8')).toBe('*\n')
    expect(fs.readFileSync(path.join(p7y, 'docker', 'key.pem'), 'utf8')).toBe(good.clientKey)
    expect(fs.readFileSync(path.join(p7y, 'docker', 'cert.pem'), 'utf8')).toBe(good.clientCert)
    expect(fs.readFileSync(path.join(p7y, 'docker', 'ca.pem'), 'utf8')).toBe(good.caCert)
    expect(fs.readFileSync(path.join(p7y, 'p7y.env'), 'utf8')).toBe('P7Y_URL=https://p7y.example.com\nP7Y_SANDBOX=p7y-shop\nP7Y_DOCKER_HOST=tcp://shop-docker.example.com:443\n')
    // .p7y stays out of an image built from the project
    expect(fs.readFileSync(path.join(project, '.dockerignore'), 'utf8')).toContain('.p7y')
    // The context keeps copies of the files: removed and created again, never only "created"
    const calls = fs.readFileSync(docker.log, 'utf8').trim().split('\n').map(l => JSON.parse(l) as string[])
    expect(calls[0]).toEqual(['context', 'rm', '-f', 'p7y-shop'])
    expect(calls[1].slice(0, 3)).toEqual(['context', 'create', 'p7y-shop'])
    expect(calls[1][4]).toBe(`host=tcp://shop-docker.example.com:443,ca=${path.join(p7y, 'docker', 'ca.pem')},cert=${path.join(p7y, 'docker', 'cert.pem')},key=${path.join(p7y, 'docker', 'key.pem')}`)
    expect(asked).toContain('/sandboxes/p7y-shop?include_keys=true')
  })

  it('a key that does not match its certificate: refused, nothing written', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-local-'))
    const [res] = await talk({ P7Y_URL: base, P7Y_TOKEN: 'p7y_tok', P7Y_DOCKER: path.join(dir, 'no-docker') },
      [{ method: 'tools/call', params: { name: 'setup_project_dir', arguments: { sandbox: 'p7y-bad', project_dir: dir } } }])
    expect((res as { isError?: boolean }).isError).toBe(true)
    expect(textOf(res)).toMatch(/does not match/)
    expect(fs.existsSync(path.join(dir, '.p7y', 'docker', 'key.pem'))).toBe(false)
  })

  it('without docker on this machine: the files, and says so', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-local-'))
    const [res] = await talk({ P7Y_URL: base, P7Y_TOKEN: 'p7y_tok', P7Y_DOCKER: path.join(dir, 'no-docker') },
      [{ method: 'tools/call', params: { name: 'setup_project_dir', arguments: { sandbox: 'p7y-shop', project_dir: dir } } }])
    const r = JSON.parse(textOf(res))
    expect(r.ok).toBe(true)
    expect(r.context).toBeNull()
    expect(r.docker).toMatch(/not found/)
  })
})
