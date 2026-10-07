import { requirePrincipal } from '../../../../services/principal'
import { getOwnedSandbox } from '../../../../services/access'
import { sandboxService } from '../../../../services/sandbox'

export const openapi = {
  summary: 'Stop sandbox',
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Sandbox stopped' },
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
    await sandboxService.stopSandbox(name)
    return Response.json({ status: 'stopped', name })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'error'
    if (msg.includes('not found')) return Response.json({ error: msg }, { status: 404 })
    return Response.json({ error: msg }, { status: 500 })
  }
}
