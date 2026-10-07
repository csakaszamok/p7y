import { describe, it, expect } from 'vitest'
import tls from 'node:tls'
import net from 'node:net'
import { readSni } from '../../services/sni'

/** A real ClientHello for `name`, captured from Node's TLS client. */
function clientHello(name: string): Promise<Buffer> {
  return new Promise(resolve => {
    const server = net.createServer(sock => sock.once('data', d => { resolve(d); sock.destroy(); server.close() }))
    server.listen(0, '127.0.0.1', () => {
      const c = tls.connect({ port: (server.address() as net.AddressInfo).port, host: '127.0.0.1', servername: name, rejectUnauthorized: false })
      c.on('error', () => {})
    })
  })
}

describe('readSni', () => {
  it('reads the name, and asks for more while the hello is incomplete', async () => {
    const hello = await clientHello('shop-docker.lvh.me')
    expect(readSni(hello)).toBe('shop-docker.lvh.me')
    expect(readSni(hello.subarray(0, 3))).toBe('more')
    expect(readSni(hello.subarray(0, hello.length - 5))).toBe('more')
  })
  it('null for something that is not a ClientHello', () => {
    expect(readSni(Buffer.from('GET / HTTP/1.1\r\n\r\n'))).toBeNull()
    expect(readSni(Buffer.from([0x16, 0x03, 0x01, 0x00, 0x02, 0x02, 0x00]))).toBeNull() // a handshake that is not a ClientHello
  })
  it('null for a record longer than a ClientHello may be (16 KB)', () => {
    expect(readSni(Buffer.from([0x16, 0x03, 0x01, 0x48, 0x01, 0x01]))).toBeNull()
  })
})
