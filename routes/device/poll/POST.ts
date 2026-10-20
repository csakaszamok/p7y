import { pollDevice } from '../../../services/deviceAuth'
import { issueProjectLink, projectLinkAnswer } from '../../../services/projectLink'

export const openapi = {
  // No auth: the device code (in the body, never a URL) is the secret
  mcp: false,
  summary: 'Poll a device approval: pending, denied, expired or approved with a single-use link',
  tags: ['device'],
  responses: {
    200: { description: '{ status: pending | denied } or { status: approved, sandbox, url, expires_in, command, context_commands }; approved is told once' },
    400: { description: 'device_code missing' },
    410: { description: '{ status: expired }: unknown, expired or already collected' },
  },
}

const headers = { 'Cache-Control': 'no-store' }

export default async (req: Request): Promise<Response> => {
  let body: unknown
  try { body = await req.json() } catch { body = null }
  const code = (body as { device_code?: unknown } | null)?.device_code
  if (typeof code !== 'string' || !code) return Response.json({ error: 'device_code is required' }, { status: 400, headers })
  const r = pollDevice(code)
  if (r.status === 'expired') return Response.json({ status: 'expired' }, { status: 410, headers })
  if (r.status !== 'approved') return Response.json({ status: r.status }, { headers })
  return Response.json({ status: 'approved', sandbox: r.sandbox, ...projectLinkAnswer(r.sandbox, issueProjectLink(r.sandbox, Date.now(), { owner: r.owner })) }, { headers })
}
