import type { Readable } from 'stream'
import { lineSplitter, splitTimestamp, serviceOf, timeKey, truncate, type LogLine } from './logLines'
import { innerDocker } from './innerDocker'
import { sandboxParent } from './sandboxPaths'

export interface LogContainer { Id: string; Names?: string[]; Labels?: Record<string, string> }
export interface LogSource {
  list(): Promise<LogContainer[]>
  tty(id: string): Promise<boolean>
  logs(id: string, o: { tail?: number; since?: number }): Promise<Readable>
}
export type LogEvent =
  | { type: 'line'; line: LogLine }
  | { type: 'status'; status: 'following' | 'stopped' | 'error' | 'empty'; text: string }
  | { type: 'stopped'; service: string }

const TAIL = 100

/** Docker's `since` (Unix seconds) just after a line's time: a reopened stream goes on, not from the start. */
const sinceAfter = (t: string) => Date.parse(t.replace(/(\.\d{3})\d+/, '$1')) / 1000 + 0.001

/** A logs request the daemon accepted but never answers (overloaded, wedged) is given up after `ms`
 * (retried at the next relist); a stream that comes after that is thrown away. */
function answered(pending: Promise<Readable>, ms: number): Promise<Readable> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error('logs request timed out'))
      pending.then(s => s.destroy(), () => {})
    }, ms)
    pending.then(s => { clearTimeout(t); resolve(s) }, e => { clearTimeout(t); reject(e) })
  })
}

/** Follows every container of a sandbox; ends (done) on stop() or when the sandbox cannot be reached. */
export function followLogs(source: LogSource, emit: (e: LogEvent) => void, opts: { relistMs?: number; settleMs?: number; openTimeoutMs?: number } = {}) {
  const relistMs = opts.relistMs ?? 5000
  const settleMs = opts.settleMs ?? 500
  const openTimeoutMs = opts.openTimeoutMs ?? 10_000
  type Known = { service: string; stream?: Readable; opening?: boolean; lastT?: string; tty?: boolean }
  const known = new Map<string, Known>()
  let stopped = false
  let empty: boolean | undefined
  let busy = false
  let timer: NodeJS.Timeout | undefined
  let settleTimer: NodeJS.Timeout | undefined
  // The first lines of all containers arrive together: held briefly, then given in time order
  let settling: LogLine[] | null = []
  let resolveDone!: () => void
  const done = new Promise<void>(r => { resolveDone = r })
  const out = (e: LogEvent) => { if (!stopped) emit(e) }
  const line = (l: LogLine) => { if (settling) settling.push(l); else out({ type: 'line', line: l }) }

  async function open(id: string, k: Known) {
    k.opening = true
    try {
      if (k.tty === undefined) k.tty = await source.tty(id)
      const s = await answered(source.logs(id, k.lastT ? { since: sinceAfter(k.lastT) } : { tail: TAIL }), openTimeoutMs)
      if (stopped || known.get(id) !== k) { s.destroy(); return }
      k.stream = s
      const split = lineSplitter(k.tty, (stream, raw) => {
        const { t, text } = splitTimestamp(raw)
        k.lastT = t
        line({ t, service: k.service, stream, line: truncate(text) })
      })
      s.on('data', (c: Buffer) => split.push(c))
      const gone = () => {
        if (k.stream !== s) return
        k.stream = undefined // reopened (since lastT) at the next relist if the container still runs
        if (known.get(id) === k) split.end()
      }
      s.on('end', gone); s.on('error', gone); s.on('close', gone)
    } catch { /* retried at the next relist */ } finally { k.opening = false }
  }

  async function relist(first = false): Promise<void> {
    if (busy || stopped) return
    busy = true
    try {
      let list: LogContainer[]
      try { list = await source.list() } catch {
        out(first
          ? { type: 'status', status: 'error', text: 'cannot reach the apps in this sandbox right now' }
          : { type: 'status', status: 'stopped', text: 'stopped following: the sandbox is asleep or stopped' })
        stop()
        return
      }
      if (stopped) return
      const ids = new Set(list.map(c => c.Id))
      for (const [id, k] of known) {
        if (ids.has(id)) continue
        known.delete(id)
        k.stream?.destroy()
        out({ type: 'stopped', service: k.service })
      }
      const nowEmpty = list.length === 0
      if (nowEmpty !== empty) {
        empty = nowEmpty
        out(nowEmpty ? { type: 'status', status: 'empty', text: 'no apps running in this sandbox yet' } : { type: 'status', status: 'following', text: 'following' })
      }
      await Promise.all(list.map(c => {
        let k = known.get(c.Id)
        if (!k) { k = { service: serviceOf(c) }; known.set(c.Id, k) }
        return k.stream || k.opening ? undefined : open(c.Id, k)
      }))
    } finally { busy = false }
  }

  function stop() {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    clearTimeout(settleTimer)
    for (const k of known.values()) k.stream?.destroy()
    known.clear()
    resolveDone()
  }

  const ready = (async () => {
    await relist(true)
    if (stopped) return
    settleTimer = setTimeout(() => {
      const first = settling ?? []
      settling = null
      first.sort((a, b) => (timeKey(a.t) < timeKey(b.t) ? -1 : timeKey(a.t) > timeKey(b.t) ? 1 : 0))
      for (const l of first) out({ type: 'line', line: l })
    }, settleMs)
    timer = setInterval(() => { void relist() }, relistMs)
  })()

  return { stop, done, ready, relist: () => relist() }
}

const viewers = new Map<string, number>()

/** A viewer slot for a sandbox's logs (at most `max` at once); the returned release may be called twice. */
export function acquireViewer(name: string, max = 5): (() => void) | null {
  const n = viewers.get(name) ?? 0
  if (n >= max) return null
  viewers.set(name, n + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const left = (viewers.get(name) ?? 1) - 1
    if (left > 0) viewers.set(name, left); else viewers.delete(name)
  }
}

/** The sandbox's inner Docker as a log source: listing gives up after 5 s, followed logs never time out. */
export function innerLogSource(name: string, usersDir = sandboxParent(name), make = innerDocker): LogSource {
  const api = make(name, usersDir, 5000)
  const follow = make(name, usersDir, 0)
  return {
    list: async () => (await api.listContainers()) as LogContainer[],
    tty: async id => Boolean((await api.getContainer(id).inspect()).Config?.Tty),
    logs: async (id, o) => (await follow.getContainer(id).logs({
      follow: true, stdout: true, stderr: true, timestamps: true,
      ...(o.since !== undefined ? { since: o.since } : { tail: o.tail ?? TAIL }),
    })) as unknown as Readable,
  }
}

/** A sandbox's logs as Server-Sent Events; a sandbox that is not running gets "asleep" (never woken). */
export function sseLogStream(o: { running: boolean; source: () => LogSource; release: () => void; keepaliveMs?: number }): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let follow: ReturnType<typeof followLogs> | undefined
  let keepalive: NodeJS.Timeout | undefined
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    clearInterval(keepalive)
    follow?.stop()
    o.release()
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => { if (!finished) controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) }
      const close = () => { if (finished) return; finish(); controller.close() }
      if (!o.running) { send('status', { status: 'asleep', text: 'asleep — start it to see its logs' }); close(); return }
      let source: LogSource
      try { source = o.source() } catch {
        send('status', { status: 'error', text: 'cannot reach the apps in this sandbox right now' }); close(); return
      }
      keepalive = setInterval(() => { if (!finished) controller.enqueue(enc.encode(': keepalive\n\n')) }, o.keepaliveMs ?? 15_000)
      follow = followLogs(source, e => {
        if (e.type === 'line') send('line', e.line)
        else if (e.type === 'stopped') send('stopped', { service: e.service })
        else send('status', { status: e.status, text: e.text })
      })
      void follow.done.then(close)
    },
    cancel() { finish() },
  })
}
