import { describe, it, expect, vi } from 'vitest'
import { PassThrough } from 'stream'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
vi.mock('../../../services/sandbox', () => ({
  sandboxService: {
    getSandbox: vi.fn(async (n: string) => {
      if (n === 'p7y-a') return { name: n, owner: 'u@example.com', status: 'running' }
      if (n === 'p7y-zz') return { name: n, owner: 'u@example.com', status: 'deep_sleep' }
      if (n === 'p7y-b') return { name: n, owner: 'other@example.com', status: 'running' }
      throw new Error(`Sandbox not found: ${n}`)
    }),
  },
}))
vi.mock('../../../services/tokens', () => ({
  resolveToken: vi.fn((t: string) => t === 'p7y_u' ? { owner: 'u@example.com', sandbox: null } : t === 'p7y_scoped' ? { owner: 'u@example.com', sandbox: 'p7y-a' } : null),
}))
vi.mock('../../../services/sandboxLogs', async orig => {
  const frame = (s: string) => { const b = Buffer.from(s); const h = Buffer.alloc(8); h[0] = 1; h.writeUInt32BE(b.length, 4); return Buffer.concat([h, b]) }
  return {
    ...(await orig<object>()),
    innerLogSource: vi.fn(() => ({
      list: async () => [{ Id: 'c1', Labels: { 'com.docker.compose.service': 'web' } }],
      tty: async () => false,
      logs: async () => { const s = new PassThrough(); s.write(frame('2026-10-02T09:00:00Z hello\n')); return s },
    })),
  }
})
const { innerLogSource } = await import('../../../services/sandboxLogs')
const { default: get } = await import('../../../routes/sandboxes/[name]/logs/stream/GET')
const req = (name: string, token?: string) => new Request(`http://localhost/sandboxes/${name}/logs/stream`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })

/** Reads the SSE body until `until` shows up (or it ends), then cancels it. */
async function readUntil(res: Response, until: string): Promise<string> {
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let text = ''
  while (!text.includes(until)) { const { done, value } = await reader.read(); if (done) return text; text += dec.decode(value) }
  await reader.cancel()
  return text
}

describe('GET /sandboxes/:name/logs/stream', () => {
  it('streams the app lines as SSE, also with a token scoped to that sandbox', async () => {
    for (const t of ['p7y_u', 'p7y_scoped', 'admin-secret']) {
      const res = await get(req('p7y-a', t))
      expect(res.status, t).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/event-stream')
      const text = await readUntil(res, 'hello')
      expect(text).toContain('event: status\ndata: {"status":"following","text":"following"}')
      expect(text).toContain('event: line\ndata: {"t":"2026-10-02T09:00:00Z","service":"web","stream":"out","line":"hello"}')
    }
  })

  it('says asleep and ends for a sandbox that is not running, without touching it', async () => {
    vi.mocked(innerLogSource).mockClear()
    const res = await get(req('p7y-zz', 'p7y_u'))
    const text = await readUntil(res, '\u0000never')
    expect(text).toBe('event: status\ndata: {"status":"asleep","text":"asleep — start it to see its logs"}\n\n')
    expect(innerLogSource).not.toHaveBeenCalled()
  })

  it('401 without sign-in, 404 for someone else\'s or a missing sandbox', async () => {
    expect((await get(req('p7y-a'))).status).toBe(401)
    expect((await get(req('p7y-b', 'p7y_u'))).status).toBe(404)
    expect((await get(req('p7y-nope', 'p7y_u'))).status).toBe(404)
    expect((await get(req('p7y-b', 'p7y_scoped'))).status).toBe(404)
  })

  it('a 6th viewer gets 429; a closed one frees its slot', async () => {
    const open = await Promise.all(Array.from({ length: 5 }, () => get(req('p7y-a', 'p7y_u'))))
    const sixth = await get(req('p7y-a', 'p7y_u'))
    expect(sixth.status).toBe(429)
    expect((await sixth.json()).error).toBe('too many log viewers for this sandbox')
    await open[0].body!.cancel()
    const again = await get(req('p7y-a', 'p7y_u'))
    expect(again.status).toBe(200)
    await Promise.all([again, ...open.slice(1)].map(r => r.body!.cancel()))
  })
})
