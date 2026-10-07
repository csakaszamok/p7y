import { requirePrincipal } from '../../../../services/principal'
import { getOwnedSandbox } from '../../../../services/access'
import { createGeneratedKey, sandboxHasSsh } from '../../../../services/sandboxSsh'

export const openapi = { summary: 'Generate the SSH key of a sandbox that has none yet (created with SSH)', tags: ['sandboxes'], security: [{ bearerAuth: [] }] }

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const name = new URL(req.url).pathname.split('/')[2]
  let owner: string
  try { owner = (await getOwnedSandbox(p, name)).owner } catch { return Response.json({ error: `Sandbox not found: ${name}` }, { status: 404 }) }
  if (!sandboxHasSsh(name)) return Response.json({ error: 'This sandbox has no SSH (created before it)' }, { status: 400 })
  try {
    return Response.json({ private_key: createGeneratedKey(name, owner) }, { status: 201 })
  } catch (err) {
    if (err instanceof Error && err.message === 'exists') return Response.json({ error: 'This sandbox already has a generated key' }, { status: 409 })
    throw err
  }
}
