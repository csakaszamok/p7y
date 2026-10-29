import { escapeHtml, pageSession } from '../../services/ui/layout'
import { activatePage, displayCode, expiredPage, fullSandboxName, messagePage, newSandboxTemplate, statusPage } from '../../services/ui/activatePage'
import { cookieHeader } from '../../services/session'
import { NEXT_COOKIE } from '../../services/appAccess/start'
import { signNext } from '../../services/appAccess/sign'
import { deviceByUserCode } from '../../services/deviceAuth'
import { getOwnedSandbox } from '../../services/access'
import { dockerAccessState } from '../../services/dockerAccess'
import { rawNameOf } from '../../services/naming'
import { clientIp } from '../../services/clientIp'

const ENABLE = 'Enable Docker access and approve'

// Only what /p9m:init asked for: one of the user's sandboxes by its name, or a new one. Nothing to pick here.
export default async (req: Request): Promise<Response> => {
  const code = new URL(req.url).searchParams.get('code') ?? ''
  const session = pageSession(req)
  if (!session) {
    // Back here after sign-in, signed like /auth/app/start's
    const next = cookieHeader(NEXT_COOKIE, signNext('/activate?code=' + encodeURIComponent(code)), 600)
    return new Response(null, { status: 303, headers: { location: '/login', 'set-cookie': next, 'cache-control': 'no-store' } })
  }
  const device = code ? deviceByUserCode(code) : null
  if (!device) return expiredPage()
  if (device.status !== 'pending') return statusPage(device.status)

  let what: string
  let approve = 'Approve'
  let busy = 'Approving…'
  let note = ''
  if (device.sandbox) {
    // The admin may tie a user's sandbox; never saying whether someone else's exists
    let fixed: { name: string; status: string }
    try { fixed = await getOwnedSandbox({ sub: session.sub, role: session.role, via: 'session' }, fullSandboxName(device.sandbox)) } catch {
      return messagePage(`You have no sandbox named ${rawNameOf(fullSandboxName(device.sandbox)) ?? device.sandbox}: run /p9m:init without a name for a new one.`, 403, 'error')
    }
    what = `Claude Code asks for access to <b>${escapeHtml(rawNameOf(fixed.name) ?? fixed.name)}</b>: a token for this sandbox only and its Docker keys, written into the project's <code>.p9m</code> folder.`
    if (dockerAccessState(fixed.name) !== 'ready') {
      approve = ENABLE
      busy = 'Turning on Docker access…'
      if (fixed.status !== 'deep_sleep') note = '<p class="muted">The sandbox restarts to turn on Docker access (~30 s).</p>'
    }
  } else {
    what = `Claude Code asks for a new sandbox from the <b>${escapeHtml(newSandboxTemplate(device.template))}</b> template: a token for it only and its Docker keys, written into the project's <code>.p9m</code> folder.`
    approve = 'Create and approve'
    busy = 'Creating the sandbox…'
    note = '<p class="muted">Creating it takes up to a minute: keep this page open.</p>'
  }
  // Asked for from another network than this browser's: most likely someone else's code
  const here = clientIp(req)
  const elsewhere = device.ip && here && device.ip !== here
    ? `<p class="approve-warn">This code was asked for from another address (${escapeHtml(device.ip)}) than this browser's (${escapeHtml(here)}). Deny it unless you ran /p9m:init on another machine yourself.</p>`
    : ''
  const pretty = displayCode(code)
  return activatePage(`<p class="user-code">${escapeHtml(pretty)}</p>
  <form method="post" action="/activate" data-activate>
    <input type="hidden" name="code" value="${escapeHtml(pretty)}">
    <p>${what}</p>
    ${note}
    ${elsewhere}
    <p class="approve-warn">Approve only if you just ran /p9m:init yourself and Claude Code shows this same code. Never approve a code someone sent you.</p>
    <div class="actions"><button class="primary" name="decision" value="approve" data-busy="${busy}">${approve}</button><button name="decision" value="deny" data-busy="Denying…" formnovalidate>Deny</button></div>
  </form>`)
}
