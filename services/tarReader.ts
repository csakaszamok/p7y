import zlib from 'zlib'
import type { Readable } from 'stream'

const MAX_TEXT = 1024 * 1024

export interface TarFile { path: string; size: number; deleted: boolean; read: () => Promise<Buffer | null> }

/**
 * Walks a gzipped tar (an image layer): each regular file once, in order, and each whiteout as a deleted
 * file. `read()` gives a file's bytes when it is at most 1 MB, else null; a file not read is skipped.
 */
export async function readTarEntries(
  stream: Readable, onFile: (e: TarFile) => Promise<void>,
  opts: { signal?: AbortSignal; maxBytes?: number; gzip?: boolean } = {},
): Promise<void> {
  const it = (opts.gzip === false ? stream : stream.pipe(zlib.createGunzip()))[Symbol.asyncIterator]()
  let buf = Buffer.alloc(0)
  let seen = 0
  const fill = async (n: number): Promise<boolean> => {
    while (buf.length < n) {
      // Stopped from outside (a timeout), or a gzip bomb: give up rather than read on
      if (opts.signal?.aborted) throw new Error('aborted')
      const { done, value } = await it.next()
      if (done) return false
      seen += (value as Buffer).length
      if (opts.maxBytes && seen > opts.maxBytes) throw new Error('layer too large once unpacked')
      buf = buf.length ? Buffer.concat([buf, value as Buffer]) : (value as Buffer)
    }
    return true
  }
  const take = async (n: number): Promise<Buffer | null> => {
    if (!(await fill(n))) return null
    const out = buf.subarray(0, n)
    buf = buf.subarray(n)
    return out
  }
  const skip = async (n: number) => {
    while (n > 0) {
      if (!(await fill(1))) return
      const k = Math.min(n, buf.length)
      buf = buf.subarray(k)
      n -= k
    }
  }
  const field = (h: Buffer, o: number, l: number) => h.subarray(o, o + l).toString('utf8').replace(/\0[\s\S]*$/, '')
  let longName: string | null = null
  for (;;) {
    const h = await take(512)
    if (!h || h.every(b => b === 0)) break
    const size = parseInt(field(h, 124, 12).trim() || '0', 8) || 0
    const type = String.fromCharCode(h[156] || 48)
    const padded = size + ((512 - (size % 512)) % 512)
    let name = field(h, 345, 155) ? `${field(h, 345, 155)}/${field(h, 0, 100)}` : field(h, 0, 100)
    if (longName) { name = longName; longName = null }
    if (type === 'L') { // GNU long name: the next entry's path
      const b = await take(padded)
      longName = b ? b.subarray(0, size).toString('utf8').replace(/\0[\s\S]*$/, '') : null
      continue
    }
    if (type === 'x') { // PAX header: may carry the next entry's path
      const b = await take(padded)
      const m = b && /\d+ path=([^\n]+)\n/.exec(b.subarray(0, size).toString('utf8'))
      if (m) longName = m[1]
      continue
    }
    name = name.replace(/^\.\//, '')
    const base = name.split('/').pop() ?? ''
    if (base.startsWith('.wh.')) {
      // .wh.<name>: <name> was deleted in this layer (it is still in an earlier one); .wh..wh..opq: opaque dir
      if (base !== '.wh..wh..opq') await onFile({ path: name.replace(/\.wh\.([^/]+)$/, '$1'), size: 0, deleted: true, read: async () => null })
      await skip(padded)
      continue
    }
    if (type !== '0' && type !== '\0' && type !== '7') { await skip(padded); continue } // directories, links, devices
    let consumed = false
    await onFile({
      path: name, size, deleted: false,
      read: async () => {
        if (consumed) return null
        consumed = true
        if (size > MAX_TEXT) { await skip(padded); return null }
        const b = await take(padded)
        return b ? Buffer.from(b.subarray(0, size)) : null
      },
    })
    if (!consumed) await skip(padded)
  }
}
