import { describe, it, expect } from 'vitest'
import { Readable } from 'node:stream'
import { tarFile, firstFile } from '../../services/tar'

const collect = async (s: AsyncIterable<Uint8Array>) => { const parts: Buffer[] = []; for await (const c of s) parts.push(Buffer.from(c)); return Buffer.concat(parts) }
// A tar arrives from Docker in chunks that do not line up with its 512-byte blocks
const chunked = (b: Buffer, size = 700) => Readable.from(Array.from({ length: Math.ceil(b.length / size) }, (_, i) => b.subarray(i * size, (i + 1) * size)))

describe('tarFile', () => {
  it('one file in a ustar archive: a 512-byte header, the data padded to 512, two empty blocks', () => {
    const t = tarFile('hello.txt', Buffer.from('hi there'), { mtime: 1_700_000_000 })
    expect(t.length).toBe(512 + 512 + 1024)
    expect(t.subarray(0, 9).toString()).toBe('hello.txt')
    expect(t.subarray(257, 262).toString()).toBe('ustar')
    expect(t.subarray(512, 520).toString()).toBe('hi there')
    // the checksum: the header's bytes summed with the checksum field as spaces
    const h = Buffer.from(t.subarray(0, 512)); const stored = parseInt(h.subarray(148, 156).toString(), 8)
    h.fill(0x20, 148, 156)
    expect(stored).toBe(h.reduce((a, b) => a + b, 0))
  })
  it('a long name goes in a pax header', async () => {
    const name = 'x'.repeat(150) + '.txt'
    const f = await firstFile(chunked(tarFile(name, Buffer.from('long'))))
    expect(f?.name).toBe(name)
    expect((await collect(f!.body)).toString()).toBe('long')
  })
})

describe('firstFile', () => {
  it("reads the first regular file's name, size and data, across chunk borders", async () => {
    const data = Buffer.alloc(5000, 7)
    const f = await firstFile(chunked(tarFile('blob.bin', data)))
    expect(f).toMatchObject({ name: 'blob.bin', size: 5000 })
    expect((await collect(f!.body)).equals(data)).toBe(true)
  })
  it('null for an archive without a regular file (a directory)', async () => {
    const dir = tarFile('d/', Buffer.alloc(0), { type: '5' })
    expect(await firstFile(chunked(dir))).toBeNull()
  })
})
