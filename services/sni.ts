/**
 * The server name a TLS client asks for, read from its ClientHello without terminating TLS.
 * 'more': not all of the hello has arrived yet; null: not a ClientHello, or one without SNI.
 */
export function readSni(buf: Buffer): string | null | 'more' {
  if (buf.length && buf[0] !== 0x16) return null // not a handshake record
  if (buf.length < 5) return 'more'
  const recLen = buf.readUInt16BE(3)
  if (recLen > 16384) return null
  if (buf.length < 5 + recLen) return 'more'
  const end = 5 + recLen
  let p = 5
  if (buf[p] !== 0x01) return null // not a ClientHello
  p += 4 + 2 + 32 // handshake header, version, random
  const fits = (n: number) => p + n <= end
  if (!fits(1)) return null
  p += 1 + buf[p] // session id
  if (!fits(2)) return null
  p += 2 + buf.readUInt16BE(p) // cipher suites
  if (!fits(1)) return null
  p += 1 + buf[p] // compression methods
  if (!fits(2)) return null
  const extEnd = Math.min(end, p + 2 + buf.readUInt16BE(p))
  p += 2
  while (p + 4 <= extEnd) {
    const type = buf.readUInt16BE(p), len = buf.readUInt16BE(p + 2)
    p += 4
    if (type === 0x0000) { // server_name: list length, then (type, length, name)*
      let q = p + 2
      while (q + 3 <= Math.min(p + len, extEnd)) {
        const nameType = buf[q], nameLen = buf.readUInt16BE(q + 1)
        q += 3
        if (nameType === 0 && q + nameLen <= extEnd) return buf.subarray(q, q + nameLen).toString('ascii').toLowerCase()
        q += nameLen
      }
      return null
    }
    p += len
  }
  return null
}
