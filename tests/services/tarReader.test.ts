import { describe, it, expect } from 'vitest'
import zlib from 'zlib'
import { Readable } from 'stream'
import { readTarEntries } from '../../services/tarReader'

/** A minimal ustar archive: [path, content] pairs (content null = directory). */
function tar(entries: Array<[string, string | null]>): Buffer {
  const blocks: Buffer[] = []
  for (const [name, content] of entries) {
    const h = Buffer.alloc(512)
    h.write(name, 0, 100, 'utf8')
    h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116)
    const body = Buffer.from(content ?? '')
    h.write(body.length.toString(8).padStart(11, '0') + '\0', 124)
    h.write('00000000000\0', 136)
    h.write(content === null ? '5' : '0', 156)
    h.write('ustar\0', 257); h.write('00', 263)
    h.fill(' ', 148, 156)
    let sum = 0
    for (const b of h) sum += b
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return zlib.gzipSync(Buffer.concat(blocks))
}

describe('readTarEntries', () => {
  it('reads files with their contents, skips directories, reports whiteouts as deleted files', async () => {
    const seen: Array<[string, boolean, string | null]> = []
    await readTarEntries(Readable.from([tar([['app/', null], ['app/index.js', 'console.log(1)'], ['app/.wh..env', '']])]), async e => {
      const b = await e.read(); seen.push([e.path, e.deleted, b ? b.toString() : null])
    })
    expect(seen).toEqual([['app/index.js', false, 'console.log(1)'], ['app/.env', true, null]])
  })
  it('skips a file it is not asked to read, and still reads the next one', async () => {
    const seen: string[] = []
    await readTarEntries(Readable.from([tar([['a.bin', 'x'.repeat(2000)], ['b.txt', 'hi']])]), async e => {
      if (e.path === 'b.txt') seen.push(String(await e.read()))
    })
    expect(seen).toEqual(['hi'])
  })
  it('does not hand over files larger than 1 MB', async () => {
    let got: Buffer | null | undefined
    await readTarEntries(Readable.from([tar([['big.txt', 'x'.repeat(1024 * 1024 + 1)], ['after.txt', 'ok']])]), async e => { if (e.path === 'big.txt') got = await e.read() })
    expect(got).toBeNull()
  })
})
