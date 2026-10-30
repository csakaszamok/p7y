import { startDevice, DEVICE_TTL_MS } from '../../../services/deviceAuth'
import { userUrl } from '../../../services/userHost'
import { listTemplates } from '../../../services/templateLoader'
import { clientIp } from '../../../services/clientIp'

export const openapi = {
  // No auth: the user approves the code in the browser (/activate); /p9m:init calls this
  mcp: false,
  summary: 'Start a device approval: a device code (secret) and a user code to approve in the browser',
  tags: ['device'],
  requestBody: {
    required: false,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            sandbox: { type: 'string', description: 'One of your sandboxes to tie to. Omit for a new one' },
            template: { type: 'string', description: 'A new sandbox from this template (GET /templates); not with sandbox. Omit for the default' },
          },
        },
      },
    },
  },
  responses: {
    200: { description: '{ device_code, user_code, verification_uri, verification_uri_complete, expires_in }: the approval page shows a confirmation code that POST /device/token takes' },
    400: { description: 'The body is not JSON, sandbox is not a name, the template is unknown, or both are given' },
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
  const { sandbox, template } = body as { sandbox?: unknown; template?: unknown }
  if (sandbox !== undefined && (typeof sandbox !== 'string' || !NAME.test(sandbox))) return Response.json({ error: 'sandbox must be a name: lower case letters, digits, - and _, up to 63' }, { status: 400, headers })
  if (template !== undefined && sandbox !== undefined) return Response.json({ error: 'template is for a new sandbox: leave out sandbox, or template' }, { status: 400, headers })
  // Told now, before the user signs in for nothing
  if (template !== undefined && (typeof template !== 'string' || !listTemplates().some(t => t.name === template))) return Response.json({ error: 'unknown template: GET /templates lists them' }, { status: 400, headers })
  let started
  try { started = startDevice({ sandbox: sandbox ?? null, template: (template as string | undefined) ?? null, ip: clientIp(req) }) } catch { return Response.json({ error: 'too many pending codes, try again in a few minutes' }, { status: 503, headers }) }
  const verification_uri = `${userUrl()}/activate`
  return Response.json({
    device_code: started.device_code,
    user_code: started.user_code,
    verification_uri,
    verification_uri_complete: `${verification_uri}?code=${started.user_code}`,
    expires_in: DEVICE_TTL_MS / 1000,
  }, { headers })
}
