import { filesRoute } from '../../../../services/filesRoute'
import { sandboxFiles, FILE_ROOTS, filesMaxUpload } from '../../../../services/sandboxFiles'

export const openapi = {
  mcp: { name: 'list_sandbox_files' },
  summary: "List a folder of the sandbox's files (only /root, /home, /srv and /opt: the folders kept over a deep sleep)",
  tags: ['files'],
  security: [{ bearerAuth: [] }],
  parameters: [{ name: 'path', in: 'query', description: 'The folder, e.g. /root/app (default: /root)', schema: { type: 'string' } }],
  responses: {
    200: { description: '{ path, roots, max_upload (bytes), entries: [{ name, type: dir | file | link | other, size, mtime }] }, folders first' },
    400: { description: 'Not in one of the four folders, or not a folder' },
    404: { description: 'Sandbox or folder not found' },
    409: { description: 'The sandbox is not running (reason: not_running)' },
  },
}

export default (req: Request): Promise<Response> => filesRoute(req, async c => {
  const path = c.path ?? '/root'
  return Response.json({ path, roots: FILE_ROOTS, max_upload: filesMaxUpload(), entries: await sandboxFiles.list(c.name, path) })
})
