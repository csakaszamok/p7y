import { redeemDevice } from '../../../services/deviceAuth'
import { issueProjectLink, projectLinkAnswer } from '../../../services/projectLink'
import { rawNameOf } from '../../../services/naming'

export const openapi = {
  // No auth: the device code and the confirmation code (both in the body, never a URL) are the secret
  mcp: false,
  summary: 'Hand in the confirmation code the user got on the approval page: a single-use link to the .p9m folder',
  tags: ['device'],
  responses: {
    200: { description: '{ status: approved, sandbox, name, url, expires_in, command, context_commands }, once; name: the sandbox as the user knows it (in its addresses, in /p9m:init)' },
    400: { description: 'device_code or code missing, or { status: wrong, tries_left }: not the code (5 wrong ones end the request)' },
    403: { description: '{ status: denied }' },
    409: { description: '{ status: pending }: not approved yet' },
    410: { description: '{ status: expired }: unknown, expired, used, or too many wrong codes' },
  },
}

const headers = { 'Cache-Control': 'no-store' }

export default async (req: Request): Promise<Response> => {
  let body: unknown
  try { body = await req.json() } catch { body = null }
  const { device_code, code } = (body ?? {}) as { device_code?: unknown; code?: unknown }
  if (typeof device_code !== 'string' || !device_code) return Response.json({ error: 'device_code is required' }, { status: 400, headers })
  if (typeof code !== 'string' || !code.trim()) return Response.json({ error: 'code is required: the confirmation code the approval page showed' }, { status: 400, headers })
  const r = redeemDevice(device_code, code)
  if (r.status === 'expired') return Response.json(r, { status: 410, headers })
  if (r.status === 'denied') return Response.json(r, { status: 403, headers })
  if (r.status === 'pending') return Response.json(r, { status: 409, headers })
  if (r.status === 'wrong') return Response.json(r, { status: 400, headers })
  return Response.json({ status: 'approved', sandbox: r.sandbox, name: rawNameOf(r.sandbox) ?? r.sandbox, ...projectLinkAnswer(r.sandbox, issueProjectLink(r.sandbox, Date.now(), { owner: r.owner })) }, { headers })
}
