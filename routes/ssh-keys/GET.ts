import { requirePrincipal } from '../../services/principal'
import { listSshKeys } from '../../services/sshKeys'

export const openapi = { summary: 'Your SSH public keys (they let you into your sandboxes as root)', tags: ['ssh-keys'], security: [{ bearerAuth: [] }] }

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  try {
    return Response.json(listSshKeys(p.sub))
  } catch (err) {
    console.error('[ssh-keys] store unreadable:', err instanceof Error ? err.message : err)
    return Response.json({ error: 'SSH key store unreadable' }, { status: 500 })
  }
}
