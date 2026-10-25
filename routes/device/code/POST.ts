import { startDevice, DEVICE_TTL_MS } from '../../../services/deviceAuth'
import { publicUrl } from '../../../services/session'

export const openapi = {
  // No auth: the user approves the code in the browser (/activate); /p9m:init calls this
  mcp: false,
  summary: 'Start a device approval: a device code (secret) and a user code to approve in the browser',
  tags: ['device'],
  responses: {
    200: { description: '{ device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval }' },
    400: { description: 'The body is not JSON, or sandbox is not a name' },
    503: { description: 'Too many pending codes' },
  },
}

const NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/
const headers = { 'Cache-Control': 'no-store' }

export default async (req: Request): Promise<Response> => {
  const text = await req.text()
  let body: unknown = {}
  if (text.trim()) { try { body = JSON.parse(text) } catch { return Response.json({ error: 'the body is not JSON' }, { status: 400, headers }) } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'the body must be a JSON object' }, { status: 400, headers })
  const sandbox = (body as { sandbox?: unknown }).sandbox
  if (sandbox !== undefined && (typeof sandbox !== 'string' || !NAME.test(sandbox))) return Response.json({ error: 'sandbox must be a name: lower case letters, digits, - and _, up to 63' }, { status: 400, headers })
  let started
  try { started = startDevice(sandbox ?? null) } catch { return Response.json({ error: 'too many pending codes, try again in a few minutes' }, { status: 503, headers }) }
  const verification_uri = `${publicUrl()}/activate`
  return Response.json({
    device_code: started.device_code,
    user_code: started.user_code,
    verification_uri,
    verification_uri_complete: `${verification_uri}?code=${started.user_code}`,
    expires_in: DEVICE_TTL_MS / 1000,
    interval: 3,
  }, { headers })
}
