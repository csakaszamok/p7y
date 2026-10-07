import { requirePrincipal } from '../../../services/principal'
import { removeSshKey } from '../../../services/sshKeys'
import { refreshOwnerSandboxes } from '../../../services/sandboxSsh'

export const openapi = { summary: 'Delete one of your SSH keys (it no longer lets you in, at once)', tags: ['ssh-keys'], security: [{ bearerAuth: [] }] }

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const id = new URL(req.url).pathname.split('/')[2]
  try {
    if (!removeSshKey(id, p.sub)) return Response.json({ error: 'SSH key not found' }, { status: 404 })
    refreshOwnerSandboxes(p.sub)
    return Response.json({ deleted: id })
  } catch (err) {
    console.error('[ssh-keys] store unreadable:', err instanceof Error ? err.message : err)
    return Response.json({ error: 'SSH key store unreadable' }, { status: 500 })
  }
}
