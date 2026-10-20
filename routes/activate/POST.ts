import { pageSession } from '../../services/ui/layout'
import { expiredPage, fullSandboxName, messagePage } from '../../services/ui/activatePage'
import { sameOrigin } from '../../services/principal'
import { approveDevice, denyDevice, deviceByUserCode } from '../../services/deviceAuth'
import { getOwnedSandbox } from '../../services/access'
import { dockerAccessState, regenerateCerts } from '../../services/dockerAccess'

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
  if (device.status !== 'pending') return messagePage(`This code was already ${device.status}.`, 409)

  if (form.get('decision') === 'deny') return denyDevice(code) ? messagePage('Denied.') : expiredPage()
  if (form.get('decision') !== 'approve') return messagePage('Bad request.', 400, 'error')

  // Checked again here, not only on the page: this is what hands out a token
  const raw = String(form.get('sandbox') ?? '')
  let sandbox
  try {
    if (!raw) throw new Error('no sandbox')
    sandbox = await getOwnedSandbox({ sub: session.sub, role: session.role, via: 'session' }, fullSandboxName(raw))
  } catch { return messagePage('You cannot give Claude Code access to this sandbox.', 403, 'error') }
  if (dockerAccessState(sandbox.name) !== 'ready') {
    try {
      // A sandbox in deep sleep has no containers to restart: the new certificates load when it wakes
      await regenerateCerts(sandbox.name, sandbox.status === 'deep_sleep' ? { restart: async () => {} } : undefined)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return messagePage(`Docker access could not be enabled (${msg}): restart the sandbox, then approve again.`, 500, 'error')
    }
  }
  // The token is the owner's, also when the admin approves a user's sandbox
  return approveDevice(code, { sandbox: sandbox.name, owner: sandbox.owner }) ? messagePage('Approved: go back to Claude Code.') : expiredPage()
}
