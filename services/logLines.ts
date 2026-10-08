import { StringDecoder } from 'string_decoder'

/** One line of a sandbox app's log. */
export interface LogLine { t: string; service: string; stream: 'out' | 'err'; line: string }
export const MAX_LINE = 8192

/** The compose service a container belongs to, else the container's own name. */
export function serviceOf(c: { Names?: string[]; Labels?: Record<string, string> }): string {
  return c.Labels?.['com.docker.compose.service'] || (c.Names?.[0] ?? '').replace(/^\//, '') || 'container'
}

/** "2026-10-02T09:00:00.123456789Z text" (docker logs --timestamps) → its time and text. */
export function splitTimestamp(raw: string): { t: string; text: string } {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) ?([\s\S]*)$/.exec(raw)
  return m ? { t: m[1], text: m[2] } : { t: new Date().toISOString(), text: raw }
}

/** A string that sorts like the time: Docker trims trailing zeros (…:00Z, …:00.5Z), so pad the fraction. */
export function timeKey(t: string): string {
  const m = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(t)
  return m ? `${m[1]}.${(m[2] ?? '').padEnd(9, '0')}` : t
}

export function truncate(text: string): string {
  return text.length > MAX_LINE ? `${text.slice(0, MAX_LINE)}…` : text
}

/** A container's log bytes → lines: Docker's 8-byte frame headers (non-TTY) or raw text (TTY, all stdout). */
export function lineSplitter(tty: boolean, onLine: (stream: 'out' | 'err', raw: string) => void) {
  let frames: Buffer = Buffer.alloc(0)
  const decoders = { out: new StringDecoder('utf8'), err: new StringDecoder('utf8') }
  const partial = { out: '', err: '' }
  const text = (stream: 'out' | 'err', bytes: Buffer) => {
    const parts = (partial[stream] + decoders[stream].write(bytes)).split('\n')
    partial[stream] = parts.pop() ?? ''
    for (const p of parts) onLine(stream, p.replace(/\r$/, ''))
    // A "line" with no newline in sight (a progress bar, binary output) is let go rather than held in memory
    if (partial[stream].length > MAX_LINE * 2) { onLine(stream, partial[stream]); partial[stream] = '' }
  }
  return {
    push(chunk: Buffer) {
      if (tty) return text('out', chunk)
      frames = frames.length ? Buffer.concat([frames, chunk]) : chunk
      while (frames.length >= 8) {
        const size = frames.readUInt32BE(4)
        if (frames.length < 8 + size) break
        text(frames[0] === 2 ? 'err' : 'out', frames.subarray(8, 8 + size))
        frames = frames.subarray(8 + size)
      }
    },
    end() {
      for (const s of ['out', 'err'] as const) {
        const rest = partial[s] + decoders[s].end()
        partial[s] = ''
        if (rest) onLine(s, rest.replace(/\r$/, ''))
      }
    },
  }
}
