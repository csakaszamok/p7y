import { describe, it, expect, vi, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import { mcpGate, mcpInclude } from '../../services/mcp'

vi.mock('../../services/session', async real => ({ ...(await real<object>()), readSession: (v?: string) => v === 'good' ? { sub: 'u@x', role: 'user' } : null }))

const routesDir = path.join(__dirname, '..', '..', 'routes')
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? files(path.join(dir, e.name)) : /^(GET|POST|PUT|PATCH|DELETE)\.ts$/.test(e.name) ? [path.join(dir, e.name)] : [])

describe('the API routes as MCP tools', () => {
  let routes: Array<{ route: string; openapi: Record<string, unknown> }>
  beforeAll(async () => {
    routes = await Promise.all(files(routesDir).map(async f => ({
      route: path.relative(routesDir, f).replace(/\\/g, '/'),
      openapi: ((await import(f)) as { openapi?: Record<string, unknown> }).openapi ?? {},
    })))
  }, 60_000)
  const tools = () => routes.filter(r => mcpInclude({ method: '', path: r.route, openapi: r.openapi }))

  it('every tool has its own valid name', () => {
    const names = tools().map(r => (r.openapi.mcp as { name?: string } | undefined)?.name)
    expect(names.filter(n => !n), 'routes without an mcp.name').toEqual([])
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]{0,63}$/)
    expect(new Set(names).size).toBe(names.length)
  })

  it('waking and sleeping are tools; pages, login, wake, streams and the zip export are not', () => {
    const byRoute = Object.fromEntries(tools().map(r => [r.route, (r.openapi.mcp as { name: string }).name]))
    expect(byRoute['sandboxes/[name]/start/POST.ts']).toBe('wake_sandbox')
    expect(byRoute['sandboxes/[name]/stop/POST.ts']).toBe('sleep_sandbox')
    for (const r of ['wake/GET.ts', 'login/POST.ts', 'index/GET.ts', 'v2/auth/GET.ts', 'sandboxes/[name]/logs/stream/GET.ts', 'sandboxes/[name]/export/POST.ts'])
      expect(byRoute[r], r).toBeUndefined()
  })
})

describe('mcpGate', () => {
  const req = (headers: Record<string, string>) => new Request('http://localhost/mcp', { method: 'POST', headers })
  it('lets a token in', () => {
    vi.stubEnv('ADMIN_TOKEN', 'admin-secret-token-123')
    try { expect(mcpGate(req({ authorization: 'Bearer admin-secret-token-123' }))).toBeNull() } finally { vi.unstubAllEnvs() }
  })
  it('401 without one, or with a browser session only (the tools would not get its cookie)', () => {
    expect(mcpGate(req({}))?.status).toBe(401)
    expect(mcpGate(req({ authorization: 'Bearer nope' }))?.status).toBe(401)
    expect(mcpGate(req({ cookie: 'p7y_session=good' }))?.status).toBe(401)
  })
})
