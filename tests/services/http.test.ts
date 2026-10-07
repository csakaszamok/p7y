import { describe, it, expect } from 'vitest'
import { toNodeHeaders } from '../../services/http'

describe('toNodeHeaders', () => {
  it('keeps every Set-Cookie header', () => {
    const h = new Headers({ 'content-type': 'text/html' })
    h.append('set-cookie', 'a=1; Path=/')
    h.append('set-cookie', 'b=; Max-Age=0')
    expect(toNodeHeaders(h)).toEqual({ 'content-type': 'text/html', 'set-cookie': ['a=1; Path=/', 'b=; Max-Age=0'] })
  })

  it('omits set-cookie when there is none', () => {
    expect(toNodeHeaders(new Headers({ location: '/' }))).toEqual({ location: '/' })
  })
})

import http from 'http'
import { writeWebResponse } from '../../services/http'

const serve = (make: () => Response) => new Promise<{ port: number; close: () => void }>(resolve => {
  const server = http.createServer((_req, res) => { void writeWebResponse(make(), res) })
  server.listen(0, () => resolve({ port: (server.address() as { port: number }).port, close: () => server.close() }))
})

describe('writeWebResponse', () => {
  it('writes an ordinary body whole', async () => {
    const s = await serve(() => new Response('hello', { status: 201, headers: { 'x-a': '1' } }))
    const body = await new Promise<string>(resolve => http.get(`http://127.0.0.1:${s.port}/`, r => {
      expect(r.statusCode).toBe(201); expect(r.headers['x-a']).toBe('1')
      let d = ''; r.on('data', c => (d += c)); r.on('end', () => resolve(d))
    }))
    expect(body).toBe('hello')
    s.close()
  })

  // A followed stream (logs) must stop its work when the browser tab closes
  it('streams chunks as they come and cancels the body when the client goes away', async () => {
    let cancelled = false
    const s = await serve(() => new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('event: status\n\n')) },
      cancel() { cancelled = true },
    }), { headers: { 'Content-Type': 'text/event-stream' } }))
    const first = await new Promise<string>(resolve => {
      const req = http.get(`http://127.0.0.1:${s.port}/`, r => r.once('data', c => { resolve(String(c)); req.destroy() }))
    })
    expect(first).toBe('event: status\n\n')
    for (let i = 0; i < 50 && !cancelled; i++) await new Promise(r => setTimeout(r, 20))
    expect(cancelled).toBe(true)
    s.close()
  })
})

describe('writeWebResponse, the client gone or slow', () => {
  // The handler may still be working (auth, docker) when the client leaves: the body must still be cancelled
  it('cancels the body of a client that left before the response was written', async () => {
    let cancelled = false
    const server = http.createServer(async (_req, res) => {
      await new Promise(r => setTimeout(r, 300))
      void writeWebResponse(new Response(new ReadableStream({
        start(c) { c.enqueue(new TextEncoder().encode('x')) },
        cancel() { cancelled = true },
      }), { headers: { 'Content-Type': 'text/event-stream' } }), res)
    })
    await new Promise<void>(r => server.listen(0, r))
    const req = http.get(`http://127.0.0.1:${(server.address() as { port: number }).port}/`)
    req.on('error', () => {})
    setTimeout(() => req.destroy(), 100)
    for (let i = 0; i < 50 && !cancelled; i++) await new Promise(r => setTimeout(r, 20))
    expect(cancelled).toBe(true)
    server.close()
  })

  // A noisy app watched over a slow link must not pile up in p7y's memory
  it('reads no further than the client takes (backpressure)', async () => {
    let pulls = 0
    const chunk = new Uint8Array(16 * 1024)
    const s = await serve(() => new Response(new ReadableStream({
      pull(c) { pulls++; if (pulls < 5000) c.enqueue(chunk); else c.close() },
    }, { highWaterMark: 1 })))
    const req = http.get(`http://127.0.0.1:${s.port}/`, r => r.pause())
    req.on('error', () => {})
    await new Promise(r => setTimeout(r, 500))
    expect(pulls).toBeLessThan(400)
    req.destroy()
    s.close()
  })
})
