import { requirePrincipal } from '../../services/principal'
import { listTemplates } from '../../services/templateLoader'

export const openapi = {
  summary: 'List the templates (what runs inside a sandbox)',
  tags: ['templates'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'The templates; default is the one used when a create request names none',
      content: {
        'application/json': {
          schema: {
            type: 'array',
            items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, default: { type: 'boolean' } } }
          }
        }
      }
    },
    401: { description: 'Unauthorized' }
  }
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const def = process.env.DEFAULT_TEMPLATE || 'starter'
  return Response.json(listTemplates().map(t => ({ name: t.name, description: t.description, default: t.name === def })))
}
