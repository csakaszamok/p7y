import { requirePrincipal } from '../../../services/principal'
import { loadTemplate, loadTemplateText } from '../../../services/templateLoader'

export const openapi = {
  mcp: { name: 'get_template' },
  summary: "A template's compose.yaml as written (to show or edit before a create)",
  tags: ['templates'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: '{ name, description, default, compose }' },
    401: { description: 'Unauthorized' },
    404: { description: 'Template not found' }
  }
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const name = decodeURIComponent(new URL(req.url).pathname.split('/')[2] ?? '')
  try {
    const t = loadTemplate(name)
    return Response.json({ name: t.name, description: t.description, default: t.name === (process.env.DEFAULT_TEMPLATE || 'starter'), compose: loadTemplateText(name) })
  } catch {
    return Response.json({ error: 'Template not found' }, { status: 404 })
  }
}
