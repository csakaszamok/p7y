import { requirePrincipal } from '../../../../services/principal'
import { getOwnedSandbox } from '../../../../services/access'
import { starterStack } from '../../../../services/composeView'

export const openapi = {
  mcp: { name: 'get_sandbox_compose' },
  summary: 'The starter stack Purgatory deployed into the sandbox (compose YAML), secrets masked',
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: '{ starter }: compose YAML, or null if no starter stack was deployed' },
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
    return Response.json({ starter: starterStack(name) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'error'
    if (msg.includes('not found')) return Response.json({ error: msg }, { status: 404 })
    return Response.json({ error: msg }, { status: 500 })
  }
}
