import { requirePrincipal } from '../../services/principal'
import { visibleSandboxes } from '../../services/access'
import { sleepTimesMany } from '../../services/sleepTimes'
import { sleepSettingsOf } from '../../services/sleepSettings'
import { limitsOf } from '../../services/resourceSettings'
import { usageOf } from '../../services/usageSampler'
import { diskOf } from '../../services/diskUsage'

export const openapi = {
  summary: 'List all sandboxes',
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Array of sandbox records' },
    401: { description: 'Unauthorized' }
  }
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const rows = await visibleSandboxes(p)
  const times = await sleepTimesMany(rows.map(s => s.name))
  return Response.json(rows.map(s => ({ ...s, ...times.get(s.name), idle_timeout: sleepSettingsOf(s.name).idle_timeout ?? null, limits: limitsOf(s.name), disk: diskOf(s.name), usage: s.status === 'running' ? usageOf(s.name) : null })))
}
