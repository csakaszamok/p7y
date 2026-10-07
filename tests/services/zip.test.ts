import { describe, it, expect } from 'vitest'
import zlib from 'zlib'
import { zip } from '../../services/zip'

/** The central directory, read back: names, sizes, CRCs, and each local entry's data. */
function unzip(z: Buffer): Array<{ name: string; data: Buffer; crc: number }> {
  const end = z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = z.readUInt16LE(end + 10), cdAt = z.readUInt32LE(end + 16)
  const out = []
  let p = cdAt
  for (let i = 0; i < count; i++) {
    const crc = z.readUInt32LE(p + 16), size = z.readUInt32LE(p + 20), nameLen = z.readUInt16LE(p + 28), local = z.readUInt32LE(p + 42)
    const name = z.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    const lNameLen = z.readUInt16LE(local + 26), lExtra = z.readUInt16LE(local + 28)
    out.push({ name, crc, data: z.subarray(local + 30 + lNameLen + lExtra, local + 30 + lNameLen + lExtra + size) })
    p += 46 + nameLen
  }
  return out
}

describe('zip', () => {
  it('writes a valid archive: names, contents and CRC-32s read back', () => {
    const z = zip([{ path: 'p7y-shop/p7y.env', data: 'P7Y_URL=https://p7y.lvh.me\n' }, { path: 'p7y-shop/docker/key.pem', data: Buffer.from('KEY') }])
    expect(z.subarray(0, 4).toString('hex')).toBe('504b0304')
    const files = unzip(z)
    expect(files.map(f => [f.name, f.data.toString()])).toEqual([['p7y-shop/p7y.env', 'P7Y_URL=https://p7y.lvh.me\n'], ['p7y-shop/docker/key.pem', 'KEY']])
    for (const f of files) expect(f.crc).toBe(zlib.crc32(f.data))
  })
})

describe('zip, review fixes', () => {
  it('marks secret files 0600 (unix) so they do not extract world-readable', () => {
    const z = zip([{ path: 'a/README.md', data: 'x' }, { path: 'a/docker/key.pem', data: 'k', mode: 0o600 }])
    const end = z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    let p = z.readUInt32LE(end + 16)
    const modes: number[] = []
    for (let i = 0; i < 2; i++) { expect(z[p + 5]).toBe(3); modes.push(z.readUInt32LE(p + 38) >>> 16); p += 46 + z.readUInt16LE(p + 28) }
    expect(modes).toEqual([0o100644, 0o100600])
  })
})
