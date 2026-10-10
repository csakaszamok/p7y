// Just enough tar for Docker's archive API (PUT and GET /containers/{id}/archive): one file in, the first file out.

const BLOCK = 512

function header(name: string, size: number, opts: { mode: number; mtime: number; type: string }): Buffer {
  const h = Buffer.alloc(BLOCK)
  const field = (value: string, at: number, len: number) => h.write(value, at, len, 'utf8')
  const octal = (n: number, at: number, len: number) => field(n.toString(8).padStart(len - 1, '0') + '\0', at, len)
  field(name, 0, 100)
  octal(opts.mode, 100, 8)
  octal(0, 108, 8)
  octal(0, 116, 8)
  octal(size, 124, 12)
  octal(Math.floor(opts.mtime), 136, 12)
  h.fill(0x20, 148, 156) // the checksum is summed with its own field as spaces
  field(opts.type, 156, 1)
  field('ustar\0', 257, 6)
  field('00', 263, 2)
  field('root', 265, 32)
  field('root', 297, 32)
  const sum = h.reduce((a, b) => a + b, 0)
  field(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  return h
}

const pad = (n: number) => Buffer.alloc((BLOCK - (n % BLOCK)) % BLOCK)

function entry(name: string, data: Buffer, opts: { mode: number; mtime: number; type: string }): Buffer[] {
  return [header(name, data.length, opts), data, pad(data.length)]
}

/** One file (or with type '5' a directory) as a tar archive; a name over 100 bytes goes in a pax header. */
export function tarFile(name: string, data: Buffer, o: { mode?: number; mtime?: number; type?: string } = {}): Buffer {
  const opts = { mode: o.mode ?? (o.type === '5' ? 0o755 : 0o644), mtime: o.mtime ?? Date.now() / 1000, type: o.type ?? '0' }
  const parts: Buffer[] = []
  if (Buffer.byteLength(name) > 100) {
    // A pax record is "<length> path=<name>\n", its length counting its own digits
    const rest = ` path=${name}\n`
    let len = Buffer.byteLength(rest) + 1
    while (String(len).length + Buffer.byteLength(rest) !== len) len = String(len).length + Buffer.byteLength(rest)
    parts.push(...entry('PaxHeader', Buffer.from(`${len}${rest}`), { ...opts, mode: 0o644, type: 'x' }))
  }
  parts.push(...entry(Buffer.from(name).subarray(0, 100).toString(), data, opts), Buffer.alloc(BLOCK * 2))
  return Buffer.concat(parts)
}

/** Reads exactly n bytes at a time from a chunked stream; null at its end. */
function reader(source: AsyncIterable<Uint8Array>) {
  const it = source[Symbol.asyncIterator]()
  let buf = Buffer.alloc(0)
  async function fill(n: number): Promise<boolean> {
    while (buf.length < n) {
      const { done, value } = await it.next()
      if (done) return false
      buf = Buffer.concat([buf, Buffer.from(value)])
    }
    return true
  }
  return {
    async read(n: number): Promise<Buffer | null> {
      if (!await fill(n)) return null
      const out = buf.subarray(0, n); buf = buf.subarray(n); return out
    },
    /** Up to n bytes, as soon as some are there (to stream a file's data). */
    async some(n: number): Promise<Buffer | null> {
      if (!buf.length && !await fill(1)) return null
      const out = buf.subarray(0, Math.min(n, buf.length)); buf = buf.subarray(out.length); return out
    },
    close: () => { it.return?.() },
  }
}

const cstr = (b: Buffer) => { const i = b.indexOf(0); return (i < 0 ? b : b.subarray(0, i)).toString('utf8') }

/** The first regular file in a tar stream: its name, size and data (streamed), or null if there is none. */
export async function firstFile(source: AsyncIterable<Uint8Array>): Promise<{ name: string; size: number; body: AsyncIterable<Uint8Array> } | null> {
  const r = reader(source)
  let longName: string | null = null
  for (;;) {
    const h = await r.read(BLOCK)
    if (!h || h.every(b => b === 0)) { r.close(); return null }
    const size = parseInt(cstr(h.subarray(124, 136)).trim() || '0', 8)
    const type = String.fromCharCode(h[156]) // '\0' is an old-style regular file
    const padded = size + pad(size).length
    if (type === '0' || type === '\0') {
      const prefix = cstr(h.subarray(345, 500))
      const name = longName ?? (prefix ? `${prefix}/${cstr(h.subarray(0, 100))}` : cstr(h.subarray(0, 100)))
      async function* body() {
        let left = size
        while (left > 0) {
          const chunk = await r.some(left)
          if (!chunk) break
          left -= chunk.length
          yield chunk
        }
        r.close()
      }
      return { name, size, body: body() }
    }
    const data = await r.read(padded)
    if (!data) { r.close(); return null }
    if (type === 'x') longName = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.subarray(0, size).toString('utf8'))?.[1] ?? longName
    else if (type === 'L') longName = cstr(data.subarray(0, size))
    else longName = null
  }
}
