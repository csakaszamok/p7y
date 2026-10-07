import type { ServerResponse } from 'http'

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
