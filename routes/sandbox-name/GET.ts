import { requirePrincipal } from '../../services/principal'
import { sandboxService } from '../../services/sandbox'

export const openapi = {
  // create_sandbox without a name generates one: an agent needs no suggestion first
  mcp: false,
  summary: 'Suggest a free name for a new sandbox (six letters and digits, k3x9q2)',
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'A name no sandbox has now (another create may still take it first)',
      content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string', example: 'k3x9q2' } } } } }
    },
    401: { description: 'Unauthorized' },
    503: { description: 'No free name was found' }
  }
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const name = await sandboxService.suggestName()
  if (!name) return Response.json({ error: 'No free sandbox name was found' }, { status: 503 })
  return Response.json({ name })
}
