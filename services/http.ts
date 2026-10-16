import type { IncomingMessage, ServerResponse } from 'http'

/** Web Headers → Node response headers; Object.fromEntries would keep only one Set-Cookie. */
export function toNodeHeaders(h: Headers): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [k, v] of h.entries()) if (k !== 'set-cookie') out[k] = v
  const cookies = h.getSetCookie()
  if (cookies.length) out['set-cookie'] = cookies
  return out
}

/** Web Response → Node response, streamed: a followed body (logs) is cancelled when the client goes away. */
export async function writeWebResponse(webRes: Response, res: ServerResponse): Promise<void> {
  res.writeHead(webRes.status, toNodeHeaders(webRes.headers))
  if (!webRes.body) { res.end(); return }
  if ((webRes.headers.get('content-type') ?? '').startsWith('text/event-stream')) res.flushHeaders()
  const reader = webRes.body.getReader()
  // The client may have left while the handler worked ('close' already fired): the finally cancels then too
  res.on('close', () => { reader.cancel().catch(() => {}) })
  try {
    while (!res.destroyed) {
      const { done, value } = await reader.read()
      if (done || res.destroyed) break
      // Read no further than the client takes: a noisy log over a slow link must not pile up here
      if (!res.write(value)) {
        await new Promise<void>(r => {
          const go = () => { res.off('drain', go); res.off('close', go); r() }
          res.on('drain', go); res.on('close', go)
        })
      }
    }
  } catch { /* cancelled, or the body failed: end what was sent */ } finally {
    reader.cancel().catch(() => {})
    res.end()
  }
}

/**
 * A request's body, up to `max` bytes: a larger one is refused (an error with status 413) as soon as it passes the
 * limit, and the rest is not kept. Every route gets its body read into memory, so this is the cap for all of them.
 */
export function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0)
    const tooLarge = () => Object.assign(new Error(`Request body over ${max} bytes`), { status: 413 })
    if (declared > max) { req.resume(); reject(tooLarge()); return }
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > max) { chunks.length = 0; req.removeAllListeners('data'); req.resume(); reject(tooLarge()); return }
      chunks.push(chunk)
    })
    req.on('end', () => { if (size <= max) resolve(Buffer.concat(chunks)) })
    req.on('error', reject)
  })
}
