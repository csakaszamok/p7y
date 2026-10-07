import { describe, it, expect, vi, afterEach } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import { attachTerminals } from '../../services/terminalServer'

const UPGRADE = 'GET /sandboxes/p7y-a1/terminal HTTP/1.1\r\nHost: a\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'
let server: http.Server | undefined
afterEach(() => new Promise<void>(r => (server ? server.close(() => r()) : r())))

async function start(gateDelayMs = 0) {
  const release = vi.fn()
  const run = vi.fn(async () => {})
  server = http.createServer((_req, res) => res.end('ok'))
  attachTerminals(server, {
    check: async () => { await new Promise(r => setTimeout(r, gateDelayMs)); return { ok: true as const, name: 'p7y-a1', sub: 'alice', release } },
    run,
  })
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r))
  const port = (server.address() as net.AddressInfo).port
  const alive = () => new Promise<string>((resolve, reject) => http.get(`http://127.0.0.1:${port}/`, res => { let b = ''; res.on('data', d => { b += d }); res.on('end', () => resolve(b)) }).on('error', reject))
  return { port, release, run, alive }
}

describe('attachTerminals', () => {
  // Node takes its own error listener off the socket before 'upgrade': without one of ours,
  // a reset while the gate is still checking was an unhandled error that killed the API
  it('survives a client that resets the connection during the gate check', async () => {
    const { port, alive, release } = await start(100)
    const c = net.connect(port, '127.0.0.1', () => { c.write(UPGRADE); setTimeout(() => c.resetAndDestroy(), 20) })
    c.on('error', () => {})
    await new Promise(r => setTimeout(r, 300))
    expect(await alive()).toBe('ok')
    expect(release).toHaveBeenCalled() // the reserved slot is given back
  })

  // A malformed frame (here unmasked) makes ws emit 'error' on the socket: unhandled, it killed the API
  it('survives a malformed websocket frame', async () => {
    const { port, alive, run } = await start()
    const c = net.connect(port, '127.0.0.1', () => {
      c.write(UPGRADE)
      c.once('data', () => c.write(Buffer.from([0x81, 0x02, 0x68, 0x69])))
    })
    c.on('error', () => {})
    await new Promise(r => setTimeout(r, 300))
    expect(run).toHaveBeenCalled()
    expect(await alive()).toBe('ok')
    c.destroy()
  })

  it('refuses with the gate status and gives nothing away', async () => {
    server = http.createServer((_req, res) => res.end('ok'))
    attachTerminals(server, { check: async () => ({ ok: false as const, status: 403 as const, reason: 'Cross-site request rejected' }), run: vi.fn() })
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', r))
    const port = (server.address() as net.AddressInfo).port
    const reply = await new Promise<string>(resolve => {
      const c = net.connect(port, '127.0.0.1', () => c.write(UPGRADE))
      let b = ''; c.on('data', d => { b += d }); c.on('close', () => resolve(b)); c.on('error', () => {})
    })
    expect(reply.split('\r\n')[0]).toBe('HTTP/1.1 403 Cross-site request rejected')
  })
})
