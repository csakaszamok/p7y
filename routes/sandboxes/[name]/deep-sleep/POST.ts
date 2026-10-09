import { requirePrincipal } from '../../../../services/principal'
import { getOwnedSandbox } from '../../../../services/access'
import { deepSleepNow } from '../../../../services/deepSleep'

export const openapi = {
  mcp: { name: 'deep_sleep_sandbox' },
  summary: 'Put a sandbox into deep sleep now (containers and network down, data kept; the next request or start rebuilds it)',
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Sandbox in deep sleep' },
    401: { description: 'Unauthorized' },
    404: { description: 'Sandbox not found' }
  }
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p

  const name = new URL(req.url).pathname.split('/')[2]
  try {
    await getOwnedSandbox(p, name)
    await deepSleepNow(name)
    return Response.json({ status: 'deep_sleep', name })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'error'
    if (msg.includes('not found')) return Response.json({ error: msg }, { status: 404 })
    return Response.json({ error: msg }, { status: 500 })
  }
}
