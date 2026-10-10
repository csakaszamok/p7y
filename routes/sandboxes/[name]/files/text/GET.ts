import { filesRoute, requirePath } from '../../../../../services/filesRoute'
import { sandboxFiles } from '../../../../../services/sandboxFiles'

export const openapi = {
  mcp: { name: 'read_sandbox_file' },
  summary: "Read a text file of the sandbox's files (UTF-8, up to 1 MB)",
  tags: ['files'],
  security: [{ bearerAuth: [] }],
  parameters: [{ name: 'path', in: 'query', required: true, description: 'e.g. /root/app/.env.example', schema: { type: 'string' } }],
  responses: {
    200: { description: '{ path, text }' },
    400: { description: 'No path, outside /root, /home, /srv and /opt, a folder, binary or over 1 MB' },
    404: { description: 'Sandbox or file not found' },
    409: { description: 'The sandbox is not running (reason: not_running)' },
  },
}

export default (req: Request): Promise<Response> => filesRoute(req, async c => {
  const p = requirePath(c)
  return Response.json({ path: p, text: await sandboxFiles.readText(c.name, p) })
})
