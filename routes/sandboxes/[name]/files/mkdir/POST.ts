import { filesRoute, requirePath } from '../../../../../services/filesRoute'
import { sandboxFiles } from '../../../../../services/sandboxFiles'

export const openapi = {
  mcp: { name: 'create_sandbox_folder' },
  summary: "Create a folder (and its parents) in the sandbox's files",
  tags: ['files'],
  security: [{ bearerAuth: [] }],
  requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['path'], properties: { path: { type: 'string', description: 'e.g. /srv/data' } } } } } },
  responses: {
    201: { description: '{ created: path }' },
    400: { description: 'No path, or outside /root, /home, /srv and /opt' },
    404: { description: 'Sandbox not found' },
    409: { description: 'The sandbox is not running (reason: not_running)' },
  },
}

export default async (req: Request): Promise<Response> => {
  const body = await req.json().catch(() => ({})) as { path?: unknown }
  return filesRoute(req, async c => {
    const path = requirePath(c)
    await sandboxFiles.mkdir(c.name, path)
    return Response.json({ created: path }, { status: 201 })
  }, { path: typeof body.path === 'string' ? body.path : null })
}
