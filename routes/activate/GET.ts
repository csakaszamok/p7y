import { escapeHtml, pageSession } from '../../services/ui/layout'
import { activatePage, displayCode, expiredPage, fullSandboxName, messagePage } from '../../services/ui/activatePage'
import { cookieHeader } from '../../services/session'
import { NEXT_COOKIE } from '../../services/appAccess/start'
import { signNext } from '../../services/appAccess/sign'
import { deviceByUserCode } from '../../services/deviceAuth'
import { getOwnedSandbox } from '../../services/access'
import { sandboxService } from '../../services/sandbox'
import { dockerAccessState } from '../../services/dockerAccess'
import { rawNameOf } from '../../services/naming'

const ENABLE = 'Enable Docker access and approve'

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
  if (device.status !== 'pending') return messagePage(`This code was already ${device.status}.`)

  // The requested sandbox only if this user may use it; otherwise their own to pick from (never saying whether it exists)
  let fixed: { name: string; status: string } | null = null
  if (device.sandbox) {
    try { fixed = await getOwnedSandbox({ sub: session.sub, role: session.role, via: 'session' }, fullSandboxName(device.sandbox)) } catch { /* pick */ }
  }
  const short = (full: string) => rawNameOf(full) ?? full
  const what = (s: string, it = 'this') => `Claude Code asks for access to ${s}: a token for ${it} sandbox only and its Docker keys, written into the project's <code>.p9m</code> folder.`
  let choice: string
  let approve = 'Approve'
  let restarts = false
  if (fixed) {
    choice = `<p>${what(`<b>${escapeHtml(short(fixed.name))}</b>`)}</p><input type="hidden" name="sandbox" value="${escapeHtml(fixed.name)}">`
    if (dockerAccessState(fixed.name) !== 'ready') { approve = ENABLE; restarts = fixed.status !== 'deep_sleep' }
  } else {
    // Only the user's own, also for the admin: never another user's sandbox name
    const own = (await sandboxService.listSandboxStates()).filter(s => s.owner === session.sub).sort((a, b) => a.name.localeCompare(b.name))
    if (!own.length) {
      choice = `<p class="error">You have no sandbox to give Claude Code: create one first, then run /p9m:init again.</p>`
      approve = ''
    } else {
      const options = own.map(s => {
        const note = dockerAccessState(s.name) === 'ready' ? '' : s.status === 'deep_sleep' ? ' (enables Docker access)' : ' (enables Docker access: it restarts, ~30 s)'
        return `<option value="${escapeHtml(s.name)}">${escapeHtml(short(s.name))}${note}</option>`
      }).join('')
      choice = `<p>${what('one of your sandboxes', 'that')}</p><label>Sandbox<select name="sandbox" required>${options}</select></label>`
    }
  }
  const pretty = displayCode(code)
  return activatePage(`<p class="user-code">${escapeHtml(pretty)}</p>
  <form method="post" action="/activate">
    <input type="hidden" name="code" value="${escapeHtml(pretty)}">
    ${choice}
    ${restarts ? '<p class="muted">The sandbox restarts to turn on Docker access (~30 s).</p>' : ''}
    <p class="approve-warn">Approve only if you just ran /p9m:init yourself and Claude Code shows this same code. Never approve a code someone sent you.</p>
    <div class="actions">${approve ? `<button class="primary" name="decision" value="approve">${approve}</button>` : ''}<button name="decision" value="deny" formnovalidate>Deny</button></div>
  </form>`)
}
