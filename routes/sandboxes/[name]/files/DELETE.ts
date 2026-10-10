import { filesRoute, requirePath } from '../../../../services/filesRoute'
import { sandboxFiles } from '../../../../services/sandboxFiles'

export const openapi = {
  mcp: { name: 'delete_sandbox_file' },
  summary: "Delete a file or a folder (with everything in it) of the sandbox's files",
  tags: ['files'],
  security: [{ bearerAuth: [] }],
  parameters: [{ name: 'path', in: 'query', required: true, description: 'e.g. /root/old.log; not /root, /home, /srv or /opt themselves', schema: { type: 'string' } }],
  responses: {
    200: { description: '{ deleted: path }' },
    400: { description: 'No path, one of the four folders, or outside them' },
    404: { description: 'Sandbox not found' },
    409: { description: 'The sandbox is not running (reason: not_running)' },
  },
}

export default (req: Request): Promise<Response> => filesRoute(req, async c => {
  const path = requirePath(c)
  await sandboxFiles.remove(c.name, path)
  return Response.json({ deleted: path })
})
