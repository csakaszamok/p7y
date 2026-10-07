import { requirePrincipal } from '../../../services/principal'
import { summaryFor } from '../../../services/summary'

export const openapi = {
  summary: 'How many sandboxes: allowed, running, asleep, in deep sleep, archived',
  description: "A user: their own, against their quota (SANDBOX_QUOTA; free = how many more they may create). The admin: the whole server, and by_owner per owner. Asleep = stopped (also one that failed to start); archived = deleted sandboxes kept in the archive, not counted against the quota.",
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: '{ quota, total, free, running, asleep, deep_sleep, archived, by_owner? }' },
    401: { description: 'Unauthorized' },
    403: { description: 'Not with a token limited to one sandbox' },
  },
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  // A token for one sandbox sees only that one: counting the rest would leak them
  if (p.sandbox) return Response.json({ error: 'not with a token limited to one sandbox' }, { status: 403 })
  return Response.json(await summaryFor(p))
}
