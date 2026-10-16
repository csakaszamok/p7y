import { filesRoute } from '../../../../services/filesRoute'
import { sandboxVolumes } from '../../../../services/sandboxVolumes'

export const openapi = {
  mcp: { name: 'list_sandbox_volumes' },
  summary: "The volumes of the apps in the sandbox's own Docker; their files are under each one's path, through the files tools",
  tags: ['files'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: '{ volumes: [{ name, path, project, containers: [{ name, service, running, mount }] }] }; path is e.g. /var/lib/docker/volumes/shop_db/_data' },
    404: { description: 'Sandbox not found' },
    409: { description: 'The sandbox is not running (reason: not_running)' },
  },
}

export default (req: Request): Promise<Response> => filesRoute(req, async c => Response.json({ volumes: await sandboxVolumes(c.name) }))
