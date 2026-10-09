import { requirePrincipal } from '../../../../../services/principal'
import { getOwnedSandbox } from '../../../../../services/access'
import { acquireViewer, innerLogSource, sseLogStream } from '../../../../../services/sandboxLogs'

export const openapi = {
  // Not an MCP tool: a stream that never ends: a tool call would not return
  mcp: false,
  summary: "Follow the sandbox's app logs (Server-Sent Events)",
  description: 'The last 100 lines of every container in the sandbox, then new ones as they come. Events: `line` ({t, service, stream, line}), `status` (following | asleep | stopped | error | empty), `stopped` ({service}). Never wakes the sandbox.',
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'text/event-stream' },
    401: { description: 'Unauthorized' },
    404: { description: 'Sandbox not found' },
    429: { description: 'Too many log viewers for this sandbox' },
  },
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const name = new URL(req.url).pathname.split('/')[2]
  let sandbox
  try { sandbox = await getOwnedSandbox(p, name) } catch (err) {
    const msg = err instanceof Error ? err.message : 'error'
    return Response.json({ error: msg }, { status: msg.includes('not found') ? 404 : 500 })
  }
  const release = acquireViewer(name)
  if (!release) return Response.json({ error: 'too many log viewers for this sandbox' }, { status: 429 })
  const body = sseLogStream({ running: sandbox.status === 'running', source: () => innerLogSource(name), release })
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
}
