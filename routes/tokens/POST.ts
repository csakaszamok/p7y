import { requirePrincipal } from '../../services/principal'
import { createToken, type TokenExpiry } from '../../services/tokens'
import { getOwnedSandbox } from '../../services/access'

export const openapi = {
  summary: 'Create a personal access token (shown once)',
  tags: ['tokens'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: {
      name: { type: 'string', maxLength: 80, example: 'laptop agent' },
      expires_in: { type: 'string', enum: ['30d', '90d', 'never'], default: '90d' },
      sandbox: { type: 'string', example: 'p7y-shop', description: 'Limit the token to this one of your sandboxes (full name)' }
    } } } }
  }
}

const EXPIRIES: TokenExpiry[] = ['30d', '90d', 'never']

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const body = await req.json().catch(() => ({})) as { name?: unknown; expires_in?: unknown; sandbox?: unknown }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 80) return Response.json({ error: 'name must be 1-80 characters' }, { status: 400 })
  const expiresIn = (body.expires_in ?? '90d') as TokenExpiry
  if (!EXPIRIES.includes(expiresIn)) return Response.json({ error: 'expires_in must be 30d, 90d or never' }, { status: 400 })
  if (body.sandbox !== undefined && body.sandbox !== null && typeof body.sandbox !== 'string') {
    return Response.json({ error: 'sandbox must be a sandbox name' }, { status: 400 })
  }
  const sandbox = typeof body.sandbox === 'string' && body.sandbox ? body.sandbox : null
  if (sandbox) {
    // Only one's own sandbox: the admin can see others', but a token for them would be the admin's
    const found = await getOwnedSandbox(p, sandbox).catch(() => null)
    if (!found || found.owner !== p.sub) return Response.json({ error: `Sandbox not found: ${sandbox}` }, { status: 404 })
  }
  try {
    const { token, info } = createToken(p.sub, name, expiresIn, new Date(), sandbox)
    return Response.json({ token, ...info }, { status: 201 })
  } catch (err) {
    console.error('[tokens] store unreadable:', err instanceof Error ? err.message : err)
    return Response.json({ error: 'Token store unreadable' }, { status: 500 })
  }
}
