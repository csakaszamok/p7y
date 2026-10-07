import { requirePrincipal } from '../../../../services/principal'
import { getOwnedSandbox } from '../../../../services/access'
import { sandboxService } from '../../../../services/sandbox'

export const openapi = {
  summary: 'Start sandbox',
  description: 'Wakes an asleep or deep-sleeping sandbox. At the owner\'s limit (running sandboxes, slots, or a full server) it answers 409 with `reason` and the `running` sandboxes; `{"sleep": "<name>"}` puts one of them to sleep first.',
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { sleep: { type: 'string', example: 'p7y-shop' } } } } } },
  responses: {
    200: { description: 'Sandbox started' },
    401: { description: 'Unauthorized' },
    404: { description: 'Sandbox not found' },
    409: { description: 'At the limit ({ error, reason, running }), or the sandbox to put to sleep is not one of the owner\'s running ones' }
  }
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p

  const name = new URL(req.url).pathname.split('/')[2]
  const body = await req.json().catch(() => ({})) as { sleep?: unknown }
  try {
    await getOwnedSandbox(p, name)
    // The sandbox to put to sleep must be one the caller may act on too
    const sleep = typeof body.sleep === 'string' && body.sleep ? (await getOwnedSandbox(p, body.sleep)).name : undefined
    await sandboxService.startSandbox(name, sleep ? { sleep } : {})
    return Response.json({ status: 'started', name })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'error'
    const e = err as { code?: string; refusal?: { reason: string; limit: number; running: string[] } }
    if (e.code === 'LIMIT' && e.refusal) return Response.json({ error: msg, reason: e.refusal.reason, limit: e.refusal.limit, running: e.refusal.running }, { status: 409 })
    if (e.code === 'BAD_SWAP') return Response.json({ error: msg }, { status: 409 })
    if (msg.includes('not found')) return Response.json({ error: msg }, { status: 404 })
    return Response.json({ error: msg }, { status: 500 })
  }
}
