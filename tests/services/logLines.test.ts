import { describe, it, expect } from 'vitest'
import { lineSplitter, splitTimestamp, serviceOf, timeKey, truncate, MAX_LINE } from '../../services/logLines'

// Docker's log frame: 1 byte stream (1 stdout, 2 stderr), 3 zero bytes, 4 bytes big-endian length, payload
const frame = (stream: 1 | 2, s: string | Buffer) => {
  const b = Buffer.isBuffer(s) ? s : Buffer.from(s)
  const h = Buffer.alloc(8); h[0] = stream; h.writeUInt32BE(b.length, 4)
  return Buffer.concat([h, b])
}
const collect = (tty: boolean) => {
  const got: Array<[string, string]> = []
  const s = lineSplitter(tty, (stream, raw) => got.push([stream, raw]))
  return { got, s }
}

describe('lineSplitter', () => {
  it('splits frames into lines, by stream, across chunk borders and several lines per frame', () => {
    const { got, s } = collect(false)
    const all = Buffer.concat([frame(1, 'one\ntwo\n'), frame(2, 'oops\n'), frame(1, 'thr'), frame(1, 'ee\n')])
    s.push(all.subarray(0, 5)); s.push(all.subarray(5, 13)); s.push(all.subarray(13))
    expect(got).toEqual([['out', 'one'], ['out', 'two'], ['err', 'oops'], ['out', 'three']])
  })

  it('keeps a multi-byte character split across chunks intact', () => {
    const { got, s } = collect(false)
    const bytes = Buffer.from('árvíztűrő\n')
    s.push(frame(1, bytes.subarray(0, 1))); s.push(frame(1, bytes.subarray(1)))
    expect(got).toEqual([['out', 'árvíztűrő']])
    const tty = collect(true)
    tty.s.push(bytes.subarray(0, 1)); tty.s.push(bytes.subarray(1))
    expect(tty.got).toEqual([['out', 'árvíztűrő']])
  })

  it('reads a TTY container raw (no frame headers) as stdout, without the \\r', () => {
    const { got, s } = collect(true)
    s.push(Buffer.from('hello\r\nworld\r\n'))
    expect(got).toEqual([['out', 'hello'], ['out', 'world']])
  })

  it('end() gives the last line without a newline; a line with no end in sight is let go', () => {
    const { got, s } = collect(false)
    s.push(frame(1, 'tail'))
    s.end()
    expect(got).toEqual([['out', 'tail']])
    const big = collect(false)
    big.s.push(frame(1, 'x'.repeat(MAX_LINE * 3)))
    expect(big.got.length).toBe(1)
  })
})

describe('line parts', () => {
  it('splits the timestamp Docker puts in front', () => {
    expect(splitTimestamp('2026-10-02T09:00:00.123456789Z GET / 200')).toEqual({ t: '2026-10-02T09:00:00.123456789Z', text: 'GET / 200' })
    expect(splitTimestamp('no time here').text).toBe('no time here')
  })

  it('orders times by value although Docker trims trailing zeros', () => {
    const ts = ['2026-10-02T09:00:00.5Z', '2026-10-02T09:00:00Z', '2026-10-02T09:00:00.123456789Z']
    expect([...ts].sort((a, b) => (timeKey(a) < timeKey(b) ? -1 : 1))).toEqual(['2026-10-02T09:00:00Z', '2026-10-02T09:00:00.123456789Z', '2026-10-02T09:00:00.5Z'])
  })

  it('names a container by its compose service, else its own name', () => {
    expect(serviceOf({ Names: ['/inner-web-1'], Labels: { 'com.docker.compose.service': 'web' } })).toBe('web')
    expect(serviceOf({ Names: ['/portainer'], Labels: {} })).toBe('portainer')
  })

  it('cuts a line over 8 KB', () => {
    expect(truncate('a'.repeat(MAX_LINE + 10))).toBe('a'.repeat(MAX_LINE) + '…')
    expect(truncate('short')).toBe('short')
  })
})
