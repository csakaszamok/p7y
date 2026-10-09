import { describe, it, expect, afterEach } from 'vitest'
import net from 'node:net'
import tls from 'node:tls'
import forge from 'node-forge'
import { classifyFirstBytes, startTcpGateway } from '../../services/tcpGateway'

function selfSigned(cn: string) {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey; cert.serialNumber = '01'
  cert.validity.notBefore = new Date(); cert.validity.notAfter = new Date(Date.now() + 86400e3)
  cert.setSubject([{ name: 'commonName', value: cn }]); cert.setIssuer([{ name: 'commonName', value: cn }])
  cert.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 2, value: cn }] }])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return { key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert) }
}
const creds = selfSigned('*.lvh.me')
const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f])
const closers: Array<() => void> = []
afterEach(() => { while (closers.length) closers.pop()!() })

/** An echo server standing in for the sandbox's port; records what it received. */
async function echo(): Promise<{ port: number; got: () => string }> {
  let got = ''
  const s = net.createServer(sock => sock.on('data', d => { got += d.toString(); sock.write(d) }))
  await new Promise<void>(r => s.listen(0, '127.0.0.1', r)); closers.push(() => s.close())
  return { port: (s.address() as net.AddressInfo).port, got: () => got }
}
async function gateway(resolve: (sni: string, signal: AbortSignal) => Promise<{ host: string; port: number } | null>, firstBytesTimeoutMs?: number) {
  const g = await startTcpGateway({ port: 0, host: '127.0.0.1', ...creds, resolve, firstBytesTimeoutMs, log: () => {} })
  closers.push(() => g.close())
  return (g.address() as net.AddressInfo).port
}
const roundTrip = (sock: tls.TLSSocket, text: string) => new Promise<string>(r => { sock.once('data', d => r(d.toString())); sock.write(text) })

describe('classifyFirstBytes', () => {
  it('tells TLS, a Postgres SSLRequest and anything else apart, and asks for more when short', () => {
    expect(classifyFirstBytes(Buffer.from([0x16, 0x03, 0x01]))).toBe('tls')
    expect(classifyFirstBytes(SSL_REQUEST)).toBe('postgres')
    expect(classifyFirstBytes(Buffer.from([0, 0, 0, 8]))).toBe('more')
    expect(classifyFirstBytes(Buffer.from('GET / HTTP/1.1\r\n'))).toBe('other')
  })
})

describe('startTcpGateway', () => {
  it('terminates TLS, routes by SNI and pipes both ways', async () => {
    const target = await echo()
    const seen: string[] = []
    const port = await gateway(async sni => { seen.push(sni); return { host: '127.0.0.1', port: target.port } })
    const sock = tls.connect({ port, host: '127.0.0.1', servername: 'shop-db-port5432-tcp.lvh.me', rejectUnauthorized: false })
    closers.push(() => sock.destroy())
    await new Promise(r => sock.once('secureConnect', r))
    expect(await roundTrip(sock, 'ping')).toBe('ping')
    expect(seen).toEqual(['shop-db-port5432-tcp.lvh.me'])
    expect(target.got()).toBe('ping')
  })

  it('answers a Postgres SSLRequest with S, then does TLS', async () => {
    const target = await echo()
    const port = await gateway(async () => ({ host: '127.0.0.1', port: target.port }))
    const raw = net.connect(port, '127.0.0.1'); closers.push(() => raw.destroy())
    await new Promise(r => raw.once('connect', r))
    raw.write(SSL_REQUEST)
    const answer = await new Promise<string>(r => raw.once('data', d => r(d.toString())))
    expect(answer).toBe('S')
    const sock = tls.connect({ socket: raw, servername: 'shop-db-tcp.lvh.me', rejectUnauthorized: false })
    await new Promise(r => sock.once('secureConnect', r))
    expect(await roundTrip(sock, 'startup')).toBe('startup')
  })

  it('closes connections it does not know, or that send no first bytes in time', async () => {
    const port = await gateway(async () => null, 300)
    const sock = tls.connect({ port, host: '127.0.0.1', servername: 'nobody-tcp.lvh.me', rejectUnauthorized: false })
    sock.on('error', () => {})
    await new Promise(r => sock.once('close', r))
    const plain = net.connect(port, '127.0.0.1'); plain.on('error', () => {}); plain.write('GET / HTTP/1.1\r\n\r\n')
    await new Promise(r => plain.once('close', r))
    const silent = net.connect(port, '127.0.0.1'); silent.on('error', () => {})
    const t0 = Date.now(); await new Promise(r => silent.once('close', r))
    expect(Date.now() - t0).toBeLessThan(3000)
  })

  it('closes a client that stalls in the middle of the handshake (1 byte of TLS, or SSLRequest then silence)', async () => {
    const port = await gateway(async () => null, 400)
    for (const first of [Buffer.from([0x16]), Buffer.from([0x16, 0x03, 0x01, 0x00, 0xc8, 0x01]), SSL_REQUEST]) {
      const s = net.connect(port, '127.0.0.1'); s.on('error', () => {})
      s.resume() // read the S the gateway answers, or 'close' is never emitted
      await new Promise(r => s.once('connect', r))
      s.write(first)
      const t0 = Date.now()
      await new Promise(r => s.once('close', r))
      expect(Date.now() - t0, first.toString('hex')).toBeLessThan(3000)
    }
  })

  it('reports a port it cannot listen on instead of crashing', async () => {
    const taken = net.createServer(); await new Promise<void>(r => taken.listen(0, '127.0.0.1', r)); closers.push(() => taken.close())
    const port = (taken.address() as net.AddressInfo).port
    await expect(startTcpGateway({ port, host: '127.0.0.1', ...creds, resolve: async () => null, log: () => {} })).rejects.toThrow(/EADDRINUSE/)
  })

  it('refuses new connections while too many are waiting for a target', async () => {
    const pending: Array<() => void> = []
    const g = await startTcpGateway({ port: 0, host: '127.0.0.1', ...creds, log: () => {}, maxPending: 2,
      resolve: () => new Promise(r => pending.push(() => r(null))) })
    closers.push(() => { pending.forEach(p => p()); g.close() })
    const port = (g.address() as net.AddressInfo).port
    const open = () => { const s = tls.connect({ port, host: '127.0.0.1', servername: 'x-tcp.lvh.me', rejectUnauthorized: false }); s.on('error', () => {}); closers.push(() => s.destroy()); return s }
    const a = open(), b = open()
    await Promise.all([a, b].map(s => new Promise(r => s.once('secureConnect', r))))
    await new Promise(r => setTimeout(r, 100))
    const c = open()
    await new Promise(r => c.once('close', r))
    expect(pending.length).toBe(2)
  })

  it('tells resolve when the client has gone, so it can stop waiting', async () => {
    let signal: AbortSignal | undefined
    const port = await gateway((_sni, s) => { signal = s; return new Promise(() => {}) })
    const sock = tls.connect({ port, host: '127.0.0.1', servername: 'slow-tcp.lvh.me', rejectUnauthorized: false })
    sock.on('error', () => {})
    await new Promise(r => sock.once('secureConnect', r))
    await new Promise(r => setTimeout(r, 50))
    expect(signal?.aborted).toBe(false)
    sock.destroy()
    await new Promise(r => setTimeout(r, 200))
    expect(signal?.aborted).toBe(true)
  })

  it('a client that leaves while the target is being resolved leaves nothing behind', async () => {
    let release: () => void = () => {}
    const target = await echo()
    const port = await gateway(() => new Promise(r => { release = () => r({ host: '127.0.0.1', port: target.port }) }))
    const sock = tls.connect({ port, host: '127.0.0.1', servername: 'slow-tcp.lvh.me', rejectUnauthorized: false })
    sock.on('error', () => {})
    await new Promise(r => sock.once('secureConnect', r))
    sock.destroy()
    await new Promise(r => setTimeout(r, 100))
    release()
    await new Promise(r => setTimeout(r, 200))
    expect(target.got()).toBe('')
  })
})

describe('passthrough (-docker names)', () => {
  const upstreamCreds = selfSigned('dockerd.internal')
  async function tlsUpstream(): Promise<number> {
    const s = tls.createServer({ key: upstreamCreds.key, cert: upstreamCreds.cert }, sock => sock.end('dockerd says hi'))
    await new Promise<void>(r => s.listen(0, '127.0.0.1', r)); closers.push(() => s.close())
    return (s.address() as net.AddressInfo).port
  }
  async function gw(resolve: (sni: string) => Promise<{ host: string; port: number } | null>, firstBytesTimeoutMs?: number) {
    const g = await startTcpGateway({ port: 0, host: '127.0.0.1', ...creds, resolve: async () => null, firstBytesTimeoutMs, log: () => {},
      passthrough: { match: sni => sni.endsWith('-docker.lvh.me'), resolve } })
    closers.push(() => g.close())
    return (g.address() as net.AddressInfo).port
  }

  it('passes the TLS stream through untouched: the client sees the upstream certificate', async () => {
    const up = await tlsUpstream()
    const port = await gw(async () => ({ host: '127.0.0.1', port: up }))
    const got = await new Promise<{ cn: string; body: string }>((resolve, reject) => {
      const c = tls.connect({ port, host: '127.0.0.1', servername: 'shop-docker.lvh.me', rejectUnauthorized: false }, () => {
        const cn = String(c.getPeerCertificate().subject.CN)
        let body = ''; c.on('data', d => (body += d)); c.on('end', () => resolve({ cn, body }))
      })
      c.on('error', reject)
    })
    expect(got).toEqual({ cn: 'dockerd.internal', body: 'dockerd says hi' })
  })

  it('closes a -docker connection without a target, and one that stalls in its first bytes', async () => {
    const port = await gw(async () => null, 300)
    const closes = (fn: (s: net.Socket) => void) => new Promise<boolean>(resolve => {
      const s = net.connect(port, '127.0.0.1', () => fn(s)); s.on('close', () => resolve(true)); s.on('error', () => {})
    })
    expect(await closes(s => { const c = tls.connect({ socket: s, servername: 'nope-docker.lvh.me', rejectUnauthorized: false }); c.on('error', () => {}) })).toBe(true)
    expect(await closes(s => s.write(Buffer.from([0x16, 0x03])))).toBe(true)
  })

  it('tells keepAlive when bytes last went through, in either direction', async () => {
    const s = tls.createServer({ key: upstreamCreds.key, cert: upstreamCreds.cert }, sock => sock.on('data', d => sock.write(d)))
    await new Promise<void>(r => s.listen(0, '127.0.0.1', r)); closers.push(() => s.close())
    const up = (s.address() as net.AddressInfo).port
    let lastTraffic: (() => number) | undefined
    const g = await startTcpGateway({ port: 0, host: '127.0.0.1', ...creds, resolve: async () => null, log: () => {},
      passthrough: { match: sni => sni.endsWith('-docker.lvh.me'), resolve: async () => ({ host: '127.0.0.1', port: up }),
        keepAlive: (_sni, last) => { lastTraffic = last; return () => {} } } })
    closers.push(() => g.close())
    const c = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const t = tls.connect({ port: (g.address() as net.AddressInfo).port, host: '127.0.0.1', servername: 'shop-docker.lvh.me', rejectUnauthorized: false }, () => resolve(t))
      t.on('error', reject)
    })
    await new Promise(r => setTimeout(r, 50))
    const afterHandshake = lastTraffic!()
    await new Promise(r => setTimeout(r, 120))
    expect(lastTraffic!()).toBe(afterHandshake)   // open, nothing sent: no traffic
    expect(await roundTrip(c, 'docker ps')).toBe('docker ps')
    expect(lastTraffic!()).toBeGreaterThanOrEqual(afterHandshake + 100)
    c.destroy()
  })

  // Docker Desktop reconnects in a loop to a sleeping sandbox's context: one line, not one per attempt
  it('says a -docker name has no target once in a while, not on every connection', async () => {
    const lines: string[] = []
    const g = await startTcpGateway({ port: 0, host: '127.0.0.1', ...creds, resolve: async () => null, log: l => lines.push(l),
      passthrough: { match: sni => sni.endsWith('-docker.lvh.me'), resolve: async () => null } })
    closers.push(() => g.close())
    const port = (g.address() as net.AddressInfo).port
    for (let i = 0; i < 3; i++) {
      await new Promise<void>(resolve => {
        const c = tls.connect({ port, host: '127.0.0.1', servername: 'shop-docker.lvh.me', rejectUnauthorized: false })
        c.on('error', () => {}); c.on('close', () => resolve())
      })
    }
    expect(lines.filter(l => l.includes('shop-docker.lvh.me')).length).toBe(1)
  })

  it('other names still go the terminating way', async () => {
    const target = await echo()
    const port = await (async () => {
      const g = await startTcpGateway({ port: 0, host: '127.0.0.1', ...creds, resolve: async () => ({ host: '127.0.0.1', port: target.port }), log: () => {},
        passthrough: { match: sni => sni.endsWith('-docker.lvh.me'), resolve: async () => null } })
      closers.push(() => g.close()); return (g.address() as net.AddressInfo).port
    })()
    const sock = await new Promise<tls.TLSSocket>(r => { const c = tls.connect({ port, host: '127.0.0.1', servername: 'shop-db-tcp.lvh.me', rejectUnauthorized: false }, () => r(c)) })
    expect(await roundTrip(sock, 'ping')).toBe('ping')
    sock.destroy()
  })
})

