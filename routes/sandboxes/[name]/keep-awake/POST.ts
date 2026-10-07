import { requirePrincipal } from '../../../../services/principal'
import { getOwnedSandbox } from '../../../../services/access'
import { primeSablierSession } from '../../../../services/wake'
import { sleepTimes } from '../../../../services/sleepTimes'

export const openapi = {
  summary: 'Start the sleep countdown over',
  description: 'For a running sandbox: one request through its router, as any visit would, so it sleeps a full idle timeout from now. Does not wake a sleeping sandbox.',
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: '{ name, stops_in, stops_at }' },
    401: { description: 'Unauthorized' },
    404: { description: 'Sandbox not found' },
    409: { description: 'Not running' },
    502: { description: 'The sandbox did not take the request' },
  },
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const name = new URL(req.url).pathname.split('/')[2]
  let sandbox
  try { sandbox = await getOwnedSandbox(p, name) } catch (err) {
    const msg = err instanceof Error ? err.message : 'error'
    return Response.json({ error: msg }, { status: msg.includes('not found') ? 404 : 500 })
  }
  if (sandbox.status !== 'running') return Response.json({ error: 'not running: start it first' }, { status: 409 })
  if (!await primeSablierSession(name, 3).catch(() => false)) {
    return Response.json({ error: 'could not reach the sandbox: try again' }, { status: 502 })
  }
  const { stops_in, stops_at } = await sleepTimes(name)
  return Response.json({ name, stops_in, stops_at })
}
