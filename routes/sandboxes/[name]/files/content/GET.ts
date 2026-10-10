import path from 'node:path'
import { filesRoute, requirePath, attachment } from '../../../../../services/filesRoute'
import { sandboxFiles } from '../../../../../services/sandboxFiles'

export const openapi = {
  // Not an MCP tool: a file's bytes (read_sandbox_file gives a text file's content)
  mcp: false,
  summary: "Download a file of the sandbox's files, or a folder as a tar archive",
  tags: ['files'],
  security: [{ bearerAuth: [] }],
  parameters: [{ name: 'path', in: 'query', required: true, description: 'e.g. /root/report.pdf or /srv/data', schema: { type: 'string' } }],
  responses: {
    200: { description: 'The file (application/octet-stream), or the folder (application/x-tar)' },
    400: { description: 'No path, or outside /root, /home, /srv and /opt' },
    404: { description: 'Sandbox, file or folder not found' },
    409: { description: 'The sandbox is not running (reason: not_running)' },
  },
}

const stream = (body: AsyncIterable<Uint8Array>) => new ReadableStream<Uint8Array>({
  async start(controller) {
    try {
      for await (const c of body) controller.enqueue(new Uint8Array(c))
      controller.close()
    } catch (err) { controller.error(err) }
  },
})

export default (req: Request): Promise<Response> => filesRoute(req, async c => {
  const p = requirePath(c)
  const d = await sandboxFiles.download(c.name, p)
  const base = path.posix.basename(p)
  return new Response(stream(d.body), {
    headers: {
      'Content-Type': d.kind === 'dir' ? 'application/x-tar' : 'application/octet-stream',
      'Content-Disposition': attachment(d.kind === 'dir' ? `${base}.tar` : base),
      ...(d.size !== null ? { 'Content-Length': String(d.size) } : {}),
    },
  })
})
