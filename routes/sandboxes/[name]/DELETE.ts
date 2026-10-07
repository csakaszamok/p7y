import { requirePrincipal } from '../../../services/principal'
import { getOwnedSandbox } from '../../../services/access'
import { sandboxService } from '../../../services/sandbox'

export const openapi = {
  summary: 'Archive sandbox',
  description: 'Stops the sandbox, saves its volumes (tar.gz) and config under opt/archive/<owner>/, then removes containers, volumes and the sandbox directory. Nothing is removed if archiving fails.',
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Sandbox archived and removed' },
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
    const archive = await sandboxService.archiveSandbox(name)
    return Response.json({ archived: name, archive })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'error'
    if (msg.includes('not found')) return Response.json({ error: msg }, { status: 404 })
    if (msg.includes('Invalid sandbox name')) return Response.json({ error: msg }, { status: 400 })
    return Response.json({ error: msg }, { status: 500 })
  }
}
