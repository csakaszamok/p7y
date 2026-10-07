import { describe, it, expect, vi, beforeEach } from 'vitest'
import http from 'http'
import net from 'net'
import { probeHttp, appStatuses, forgetAppStatuses } from '../../services/appProbe'

const listen = (server: http.Server | net.Server) => new Promise<number>(r => server.listen(0, '127.0.0.1', () => r((server.address() as net.AddressInfo).port)))

describe('probeHttp', () => {
  it('any HTTP answer counts, a 404 too', async () => {
    const s = http.createServer((_q, r) => { r.statusCode = 404; r.end('nope') })
    const port = await listen(s)
    expect(await probeHttp('127.0.0.1', port)).toBe(true)
    s.close()
  })

  it('a refused connection, a silent one (timeout) and a non-HTTP answer do not', async () => {
    const closed = net.createServer(); const p = await listen(closed); closed.close()
    expect(await probeHttp('127.0.0.1', p)).toBe(false)
    const silent = net.createServer(() => {}); const sp = await listen(silent)
    const t0 = Date.now()
    expect(await probeHttp('127.0.0.1', sp, 200)).toBe(false)
    expect(Date.now() - t0).toBeLessThan(1500)
    silent.close()
    const junk = net.createServer(c => c.end('SSH-2.0-OpenSSH\r\n')); const jp = await listen(junk)
    expect(await probeHttp('127.0.0.1', jp)).toBe(false)
    junk.close()
  })
})

describe('probeHttp, a trickling app', () => {
  // An idle timeout resets on every byte: an app sending its headers one byte at a time must not hold the panel
  it('gives up after the timeout in all, not per byte', async () => {
    const s = net.createServer(c => { c.write('HTTP/1.1 200 OK\r\nX-Slow: '); const t = setInterval(() => c.write('a'), 50); c.on('close', () => clearInterval(t)); c.on('error', () => clearInterval(t)) })
    const port = await listen(s)
    const t0 = Date.now()
    expect(await probeHttp('127.0.0.1', port, 300)).toBe(false)
    expect(Date.now() - t0).toBeLessThan(1000)
    s.close()
  })
})

describe('appStatuses', () => {
  beforeEach(() => forgetAppStatuses())
  it('probes each link on the sandbox host and remembers it for 10 s', async () => {
    let t = 0
    const probe = vi.fn(async (_h: string, port: number) => port === 8080)
    const links = [{ url: 'shop-inner-web-port8080.lvh.me', port: 8080, service: 'web' }, { url: 'shop-inner-hermes-port9119.lvh.me', port: 9119, service: 'hermes' }]
    expect(await appStatuses('p7y-shop', links, { probe, now: () => t })).toEqual([
      { url: 'shop-inner-web-port8080.lvh.me', port: 8080, service: 'web', answers: true },
      { url: 'shop-inner-hermes-port9119.lvh.me', port: 9119, service: 'hermes', answers: false },
    ])
    expect(probe.mock.calls).toEqual([['p7y-shop', 8080], ['p7y-shop', 9119]])
    t = 9_000; await appStatuses('p7y-shop', links, { probe, now: () => t })
    expect(probe).toHaveBeenCalledTimes(2)
    t = 10_500; await appStatuses('p7y-shop', links, { probe, now: () => t })
    expect(probe).toHaveBeenCalledTimes(4)
  })
})
