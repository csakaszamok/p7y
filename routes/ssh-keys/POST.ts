import { requirePrincipal } from '../../services/principal'
import { addSshKey } from '../../services/sshKeys'
import { refreshOwnerSandboxes } from '../../services/sandboxSsh'

export const openapi = {
  summary: 'Add an SSH public key: it lets you into all your sandboxes with SSH as root',
  tags: ['ssh-keys'],
  security: [{ bearerAuth: [] }],
  requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['key'], properties: {
    key: { type: 'string', example: 'ssh-ed25519 AAAAC3Nza… me@laptop' },
    name: { type: 'string', maxLength: 80, description: "Defaults to the key's comment" }
  } } } } }
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const body = await req.json().catch(() => ({})) as { key?: unknown; name?: unknown }
  if (typeof body.key !== 'string') return Response.json({ error: 'key must be an SSH public key' }, { status: 400 })
  if (body.name !== undefined && typeof body.name !== 'string') return Response.json({ error: 'name must be a string' }, { status: 400 })
  try {
    const r = addSshKey(p.sub, body.key, body.name as string | undefined)
    if ('error' in r) return Response.json({ error: r.error }, { status: r.status })
    refreshOwnerSandboxes(p.sub)
    return Response.json(r.info, { status: 201 })
  } catch (err) {
    console.error('[ssh-keys] store unreadable:', err instanceof Error ? err.message : err)
    return Response.json({ error: 'SSH key store unreadable' }, { status: 500 })
  }
}
