import { filesRoute, requirePath } from '../../../../../services/filesRoute'
import { sandboxFiles, filesMaxUpload } from '../../../../../services/sandboxFiles'
import { formatBytes } from '../../../../../services/resources'

export const openapi = {
  mcp: { name: 'write_sandbox_file' },
  summary: "Upload a file into the sandbox's files (replaces one of the same name); its folder must exist",
  tags: ['files'],
  security: [{ bearerAuth: [] }],
  parameters: [{ name: 'path', in: 'query', required: true, description: 'The file to write, e.g. /root/app/config.json', schema: { type: 'string' } }],
  requestBody: { required: true, description: "The file's content", content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
  responses: {
    201: { description: '{ path, size }' },
    400: { description: 'No path, or outside /root, /home, /srv and /opt' },
    404: { description: 'Sandbox or folder not found' },
    409: { description: 'The sandbox is not running (reason: not_running)' },
    413: { description: 'Larger than FILES_MAX_UPLOAD' },
  },
}

export default (req: Request): Promise<Response> => filesRoute(req, async c => {
  const p = requirePath(c)
  const max = filesMaxUpload()
  const data = Buffer.from(await req.arrayBuffer())
  if (data.length > max) return Response.json({ error: `The file is larger than ${formatBytes(max)} (FILES_MAX_UPLOAD)` }, { status: 413 })
  await sandboxFiles.write(c.name, p, data)
  return Response.json({ path: p, size: data.length }, { status: 201 })
})
