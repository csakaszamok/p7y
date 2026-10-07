import net from 'node:net'
import tls from 'node:tls'
import { Duplex } from 'node:stream'
import { readSni } from './sni'

export interface Target { host: string; port: number }
const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f])

/** What a connection starts with: a TLS handshake, a Postgres SSLRequest, or something else. */
export function classifyFirstBytes(buf: Buffer): 'tls' | 'postgres' | 'other' | 'more' {
  if (buf.length === 0) return 'more'
  if (buf[0] === 0x16) return 'tls'
  const n = Math.min(buf.length, SSL_REQUEST.length)
  if (buf.subarray(0, n).equals(SSL_REQUEST.subarray(0, n))) return buf.length >= SSL_REQUEST.length ? 'postgres' : 'more'
  return 'other'
}

/**
 * TLS-only TCP entry for sandbox ports (Traefik passes `*-tcp.<domain>` through to it).
 * A Postgres client first sends an SSLRequest: answer S, then TLS. The SNI name picks
 * the target; the plaintext side goes to the sandbox container over traefik-net.
 *
 * Anyone can reach it (through Traefik, and from inside sandboxes on traefik-net), so:
 * one deadline covers everything up to a finished TLS handshake, at most `maxPending`
 * connections may wait for a target at once, and `resolve` is told when the client leaves.
 */
export function startTcpGateway(opts: {
  port: number; host?: string; key: string | Buffer; cert: string | Buffer
  resolve: (sni: string, signal: AbortSignal) => Promise<Target | null>
  firstBytesTimeoutMs?: number; maxPending?: number; log?: (line: string) => void
  /** Names whose TLS is not ours to terminate (a sandbox's dockerd): the stream goes through as it came. */
  passthrough?: {
    match: (sni: string) => boolean
    resolve: (sni: string, signal: AbortSignal) => Promise<Target | null>
    /** While the connection is open (e.g. renewing the sandbox's sleep timer); returns its stop. */
    keepAlive?: (sni: string) => () => void
  }
}): Promise<net.Server> {
  const log = opts.log ?? (line => console.log(`[tcp] ${line}`))
  const maxPending = opts.maxPending ?? 256
  let pending = 0

  const server = net.createServer(client => {
    client.on('error', () => {})
    let buf = Buffer.alloc(0)
    // Until the TLS handshake is done: a client that sends nothing, part of a message, or stalls
    // after the SSLRequest is closed here, so it cannot hold a socket for ever.
    const timer = setTimeout(() => client.destroy(), opts.firstBytesTimeoutMs ?? 10_000)
    client.on('close', () => clearTimeout(timer))
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      const kind = classifyFirstBytes(buf)
      if (kind === 'more') return
      if (kind === 'tls' && opts.passthrough) {
        const sni = readSni(buf)
        if (sni === 'more') return // the rest of the ClientHello is on its way (the first-bytes timer still runs)
        if (sni && opts.passthrough.match(sni)) { client.off('data', onData); void passThrough(client, buf, sni, timer); return }
      }
      client.off('data', onData)
      if (kind === 'other') { client.destroy(); return }
      if (kind === 'postgres') {
        client.write('S')
        terminate(withPrefix(client, buf.subarray(SSL_REQUEST.length)), timer)
      } else {
        terminate(withPrefix(client, buf), timer)
      }
    }
    client.on('data', onData)
  })
  server.on('error', err => log(`server: ${err.message}`))

  /**
   * The socket as a stream that first yields the bytes already read while sniffing.
   * (A TLSSocket wrapped directly around the net.Socket would read it natively and
   * never see bytes handed back with unshift, so the handshake would never start.)
   */
  function withPrefix(sock: net.Socket, prefix: Buffer): Duplex {
    const d = new Duplex({
      read() { sock.resume() },
      write(chunk, _enc, cb) { sock.write(chunk, cb) },
      final(cb) { sock.end(); cb() },
      destroy(err, cb) { sock.destroy(); cb(err) },
    })
    if (prefix.length) d.push(prefix)
    sock.on('data', chunk => { if (!d.push(chunk)) sock.pause() })
    sock.on('end', () => d.push(null))
    sock.on('close', () => d.destroy())
    return d
  }

  /** The TLS stream as it came, to the target the passthrough resolver picks: the gateway never holds its keys. */
  async function passThrough(client: net.Socket, first: Buffer, sni: string, timer: NodeJS.Timeout) {
    clearTimeout(timer)
    if (pending >= maxPending) { log(`${sni}: too many connections waiting, refused`); client.destroy(); return }
    client.pause()
    const gone = new AbortController()
    client.once('close', () => gone.abort())
    pending++
    let target: Target | null = null
    try { target = await opts.passthrough!.resolve(sni, gone.signal) } catch (err) { log(`${sni}: ${err instanceof Error ? err.message : err}`) }
    finally { pending-- }
    if (!target) { log(`${sni}: no such address`); client.destroy(); return }
    if (client.destroyed) return
    const upstream = net.connect(target.port, target.host)
    const stopKeepAlive = opts.passthrough!.keepAlive?.(sni) ?? (() => {})
    upstream.on('error', err => { log(`${sni} → ${target!.host}:${target!.port}: ${err.message}`); client.destroy() })
    client.on('close', () => { stopKeepAlive(); upstream.destroy() })
    upstream.on('close', () => client.destroy())
    upstream.once('connect', () => {
      log(`${sni} → ${target!.host}:${target!.port} (passthrough)`)
      upstream.write(first)
      client.pipe(upstream).pipe(client)
      client.resume()
    })
  }

  function terminate(raw: Duplex, handshakeTimer: NodeJS.Timeout) {
    const secure = new tls.TLSSocket(raw, { isServer: true, key: opts.key, cert: opts.cert })
    secure.on('error', err => { log(`TLS: ${err.message}`); secure.destroy() })
    secure.once('secure', async () => {
      clearTimeout(handshakeTimer)
      const sni = (secure as tls.TLSSocket & { servername?: string }).servername || ''
      if (pending >= maxPending) { log(`${sni}: too many connections waiting, refused`); secure.destroy(); return }
      secure.pause()
      const gone = new AbortController()
      secure.once('close', () => gone.abort())
      pending++
      let target: Target | null = null
      try { target = await opts.resolve(sni, gone.signal) } catch (err) { log(`${sni}: ${err instanceof Error ? err.message : err}`) }
      finally { pending-- }
      if (!target) { log(`${sni || '(no SNI)'}: no such address`); secure.destroy(); return }
      if (secure.destroyed) return // the client left while we were resolving (waking)
      const upstream = net.connect(target.port, target.host)
      upstream.on('error', err => { log(`${sni} → ${target!.host}:${target!.port}: ${err.message}`); secure.destroy() })
      secure.on('close', () => upstream.destroy())
      upstream.on('close', () => secure.destroy())
      upstream.once('connect', () => {
        log(`${sni} → ${target!.host}:${target!.port}`)
        secure.pipe(upstream).pipe(secure)
        secure.resume()
      })
    })
  }

  return new Promise((resolve, reject) => {
    const onListenError = (err: Error) => reject(err)
    server.once('error', onListenError)
    server.listen(opts.port, opts.host ?? '0.0.0.0', () => { server.off('error', onListenError); resolve(server) })
  })
}
