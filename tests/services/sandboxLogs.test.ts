import { describe, it, expect, vi } from 'vitest'
import { PassThrough } from 'stream'
import { followLogs, acquireViewer, innerLogSource, type LogContainer, type LogEvent } from '../../services/sandboxLogs'

const frame = (stream: 1 | 2, s: string) => {
  const b = Buffer.from(s); const h = Buffer.alloc(8); h[0] = stream; h.writeUInt32BE(b.length, 4)
  return Buffer.concat([h, b])
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const web: LogContainer = { Id: 'c1', Names: ['/inner-web-1'], Labels: { 'com.docker.compose.service': 'web' } }
const db: LogContainer = { Id: 'c2', Names: ['/inner-db-1'], Labels: { 'com.docker.compose.service': 'db' } }

function fake(initial: LogContainer[]) {
  let containers = initial
  let failList = false
  const streams = new Map<string, PassThrough>()
  const calls: Array<[string, { tail?: number; since?: number }]> = []
  const source = {
    list: vi.fn(async () => { if (failList) throw new Error('connect ECONNREFUSED'); return containers }),
    tty: vi.fn(async () => false),
    logs: vi.fn(async (id: string, o: { tail?: number; since?: number }) => { calls.push([id, o]); const s = new PassThrough(); streams.set(id, s); return s }),
  }
  return { source, streams, calls, set: (c: LogContainer[]) => { containers = c }, fail: () => { failList = true } }
}
const run = (f: ReturnType<typeof fake>, settleMs = 0) => {
  const events: LogEvent[] = []
  const h = followLogs(f.source, e => events.push(e), { relistMs: 1e9, settleMs })
  return { events, h, lines: () => events.flatMap(e => (e.type === 'line' ? [`${e.line.service}:${e.line.stream}:${e.line.line}`] : [])) }
}

describe('followLogs', () => {
  it('opens the last 100 lines of every container and gives the first ones in time order', async () => {
    const f = fake([web, db])
    const { events, h, lines } = run(f, 30)
    await h.ready
    expect(f.calls).toEqual([['c1', { tail: 100 }], ['c2', { tail: 100 }]])
    f.streams.get('c1')!.write(frame(1, '2026-10-02T09:00:02Z GET /\n'))
    f.streams.get('c2')!.write(frame(2, '2026-10-02T09:00:01.5Z ready\n'))
    await wait(80)
    expect(events[0]).toEqual({ type: 'status', status: 'following', text: 'following' })
    expect(lines()).toEqual(['db:err:ready', 'web:out:GET /'])
    f.streams.get('c1')!.write(frame(1, '2026-10-02T09:00:00Z late but live\n'))
    await wait(10)
    expect(lines().at(-1)).toBe('web:out:late but live') // after the start: arrival order
    h.stop()
  })

  it('picks up a new container, reports one that went, and reopens a broken stream from where it left off', async () => {
    const f = fake([web])
    const { events, h, lines } = run(f)
    await h.ready
    await wait(5)
    f.streams.get('c1')!.write(frame(1, '2026-10-02T09:00:05Z hi\n'))
    await wait(5)
    f.streams.get('c1')!.destroy(new Error('socket hang up'))
    await wait(5) // 'error'/'close' come on the next tick
    f.set([web, db])
    await h.relist()
    expect(f.calls.at(-2)).toEqual(['c1', { since: Date.parse('2026-10-02T09:00:05Z') / 1000 + 0.001 }])
    expect(f.calls.at(-1)).toEqual(['c2', { tail: 100 }])
    f.set([db])
    await h.relist()
    expect(events.at(-1)).toEqual({ type: 'stopped', service: 'web' })
    expect(f.streams.get('c1')!.destroyed).toBe(true)
    f.streams.get('c2')!.write(frame(1, '2026-10-02T09:00:06Z still here\n'))
    await wait(5)
    expect(lines().at(-1)).toBe('db:out:still here')
    h.stop()
  })

  it('says when there are no apps yet, and follows them once they come', async () => {
    const f = fake([])
    const { events, h } = run(f)
    await h.ready
    expect(events).toEqual([{ type: 'status', status: 'empty', text: 'no apps running in this sandbox yet' }])
    f.set([web])
    await h.relist()
    expect(events.at(-1)).toEqual({ type: 'status', status: 'following', text: 'following' })
    h.stop()
  })

  it('ends with error when the inner Docker cannot be reached at the start', async () => {
    const f = fake([web]); f.fail()
    const { events, h } = run(f)
    await h.done
    expect(events).toEqual([{ type: 'status', status: 'error', text: 'cannot reach the apps in this sandbox right now' }])
  })

  it('ends with stopped when the sandbox goes away while following, closing every stream', async () => {
    const f = fake([web, db])
    const { events, h } = run(f)
    await h.ready
    f.fail()
    await h.relist()
    await h.done
    expect(events.at(-1)).toEqual({ type: 'status', status: 'stopped', text: 'stopped following: the sandbox is asleep or stopped' })
    expect([...f.streams.values()].every(s => s.destroyed)).toBe(true)
  })

  it('stop() closes every stream and emits nothing after', async () => {
    const f = fake([web])
    const { events, h } = run(f)
    await h.ready
    h.stop()
    await h.done
    const n = events.length
    f.streams.get('c1')!.write(frame(1, '2026-10-02T09:00:00Z after\n'))
    await wait(5)
    expect(f.streams.get('c1')!.destroyed).toBe(true)
    expect(events.length).toBe(n)
  })
})

describe('acquireViewer', () => {
  it('lets 5 watch one sandbox at once; a slot comes back once (release is idempotent)', () => {
    const r = Array.from({ length: 5 }, () => acquireViewer('p7y-v'))
    expect(r.every(Boolean)).toBe(true)
    expect(acquireViewer('p7y-v')).toBeNull()
    expect(acquireViewer('p7y-other')).not.toBeNull()
    r[0]!(); r[0]!()
    expect(acquireViewer('p7y-v')).not.toBeNull()
    expect(acquireViewer('p7y-v')).toBeNull()
  })
})

describe('innerLogSource', () => {
  // A quiet app may not log for hours: a request timeout would cut its followed stream
  it('lists with a 5 s timeout but follows logs with none', () => {
    const make = vi.fn((_n: string, _d?: string, timeout?: number) => ({ timeout }) as never)
    innerLogSource('p7y-a', '/x', make)
    expect(make.mock.calls.map(c => c[2])).toEqual([5000, 0])
  })
})

describe('followLogs, a stalled daemon', () => {
  // The inner Docker accepts the request but never answers: the follower must not freeze
  it('gives up on a logs call that never answers and keeps relisting', async () => {
    const f = fake([web])
    const hung = new PassThrough()
    let resolveHung!: (s: PassThrough) => void
    f.source.logs.mockImplementationOnce(async (id: string, o: { tail?: number; since?: number }) => { f.calls.push([id, o]); return new Promise<PassThrough>(r => { resolveHung = r }) })
    const events: LogEvent[] = []
    const h = followLogs(f.source, e => events.push(e), { relistMs: 1e9, settleMs: 0, openTimeoutMs: 50 })
    await Promise.race([h.ready, wait(1000)])
    f.set([web, db])
    await h.relist()
    expect(f.calls.map(c => c[0])).toEqual(['c1', 'c1', 'c2']) // c1 tried again, c2 picked up
    resolveHung(hung) // answers at last: thrown away
    await wait(5)
    expect(hung.destroyed).toBe(true)
    h.stop()
  })
})
