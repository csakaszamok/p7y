import { filesRoute } from '../../../../services/filesRoute'
import { sandboxContainers } from '../../../../services/sandboxContainers'

export const openapi = {
  mcp: { name: 'list_sandbox_containers' },
  summary: "The containers in the sandbox's own Docker (the apps of its compose projects and any others)",
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: '{ containers: [{ name, project, service, image, state, status }] }; running ones first' },
    404: { description: 'Sandbox not found' },
    409: { description: 'The sandbox is not running (reason: not_running)' },
  },
}

export default (req: Request): Promise<Response> => filesRoute(req, async c => Response.json({ containers: await sandboxContainers(c.name) }))
