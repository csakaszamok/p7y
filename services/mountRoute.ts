import { getOwnedSandbox } from './access'
import { MountError, type HostMount } from './hostMounts'
import type { Principal } from './principal'

/** Adding or removing a host mount (routes/sandboxes/[name]/mounts): the admin only, on a sandbox that exists. */
export async function mountRoute(req: Request, p: Principal, change: (name: string, status: string) => Promise<HostMount[]>): Promise<Response> {
  // A mount hands a host folder to the sandbox's owner: never their own call
  if (p.role !== 'admin') return Response.json({ error: 'only the administrator can mount host folders' }, { status: 403 })
  const name = new URL(req.url).pathname.split('/')[2]
  try {
    const sandbox = await getOwnedSandbox(p, name)
    return Response.json({ name, mounts: await change(name, sandbox.status) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'error'
    if (err instanceof MountError) return Response.json({ error: msg }, { status: err.status })
    if (msg.includes('not found')) return Response.json({ error: msg }, { status: 404 })
    if (msg.includes('Invalid sandbox name')) return Response.json({ error: msg }, { status: 400 })
    return Response.json({ error: msg }, { status: 500 })
  }
}
