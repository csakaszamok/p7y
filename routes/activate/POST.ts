import { pageSession } from '../../services/ui/layout'
import { confirmPage, expiredPage, fullSandboxName, messagePage, statusPage } from '../../services/ui/activatePage'
import { sameOrigin, type Principal } from '../../services/principal'
import { approveDevice, claimDevice, denyDevice, deviceByUserCode, releaseDevice } from '../../services/deviceAuth'
import { getOwnedSandbox } from '../../services/access'
import { dockerAccessState, regenerateCerts } from '../../services/dockerAccess'
import { createSandboxRequest } from '../../services/sandboxCreate'

export default async (req: Request): Promise<Response> => {
  const session = pageSession(req)
  if (!session) return new Response(null, { status: 303, headers: { location: '/login' } })
  // A page on another site must not approve a code for the signed-in user
  if (!sameOrigin(req)) return messagePage('Cross-site request rejected.', 403, 'error')
  let form: FormData
  try { form = await req.formData() } catch { return messagePage('Bad request.', 400, 'error') }
  const code = String(form.get('code') ?? '')
  const device = code ? deviceByUserCode(code) : null
  if (!device) return expiredPage()
  if (device.status !== 'pending') return statusPage(device.status, 409)

  if (form.get('decision') === 'deny') return denyDevice(code) ? messagePage('Denied.') : expiredPage()
  if (form.get('decision') !== 'approve') return messagePage('Bad request.', 400, 'error')

  // A second click while the first one still works finds it taken
  if (!claimDevice(code)) return statusPage('working', 409)
  const p: Principal = { sub: session.sub, role: session.role, via: 'session' }
  let grant: { sandbox: string; owner: string }
  try {
    if (device.sandbox) {
      // Checked again here, not only on the page: this is what hands out a token
      let sandbox
      try { sandbox = await getOwnedSandbox(p, fullSandboxName(device.sandbox)) } catch {
        releaseDevice(code)
        return messagePage('You cannot give Claude Code access to this sandbox.', 403, 'error')
      }
      const failed = await withDockerAccess(sandbox.name, sandbox.status)
      if (failed) { releaseDevice(code); return failed }
      // The token is the owner's, also when the admin approves a user's sandbox
      grant = { sandbox: sandbox.name, owner: sandbox.owner }
    } else {
      // The same create as POST /sandboxes: the user's limits and the server's room apply
      const res = await createSandboxRequest(p, device.template ? { template: device.template } : {})
      const body = await res.json().catch(() => ({})) as { name?: string; error?: string }
      if (res.status !== 201 || !body.name) {
        releaseDevice(code)
        return messagePage(`The sandbox could not be created: ${body.error ?? `error ${res.status}`}`, res.status === 201 ? 500 : res.status, 'error')
      }
      const name = fullSandboxName(body.name)
      const failed = await withDockerAccess(name, 'running')
      if (failed) { releaseDevice(code); return failed }
      grant = { sandbox: name, owner: session.sub }
    }
  } catch (err) {
    releaseDevice(code)
    throw err
  }
  const confirm = approveDevice(code, grant)
  return confirm ? confirmPage(confirm) : expiredPage()
}

/** Docker access on (new certificates) unless it is; the error page when it fails */
async function withDockerAccess(name: string, status: string): Promise<Response | null> {
  if (dockerAccessState(name) === 'ready') return null
  try {
    // A sandbox in deep sleep has no containers to restart: the new certificates load when it wakes
    await regenerateCerts(name, status === 'deep_sleep' ? { restart: async () => {} } : undefined)
    return null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return messagePage(`Docker access could not be enabled (${msg}): restart the sandbox, then approve again.`, 500, 'error')
  }
}
