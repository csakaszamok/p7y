import { pageSession, redirect, html, escapeHtml, htmlTag } from '../../../../services/ui/layout'
import { getOwnedSandbox } from '../../../../services/access'
import { rawNameOf } from '../../../../services/naming'
import { faviconTag, logoImg, titleSuffix } from '../../../../services/ui/brand'

/** The browser terminal page; the websocket on this same path is handled in server.ts (upgrade). */
export default async (req: Request): Promise<Response> => {
  const session = pageSession(req)
  if (!session) return redirect('/login')
  let name: string
  try { name = decodeURIComponent(new URL(req.url).pathname.split('/')[2]) } catch { return html('<p>Sandbox not found.</p>', 404) }
  try { await getOwnedSandbox({ sub: session.sub, role: session.role, via: 'session' }, name) } catch { return html('<p>Sandbox not found.</p>', 404) }
  const short = escapeHtml(rawNameOf(name) ?? name)
  return html(`<!DOCTYPE html>
${htmlTag(session.sub)}<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${short} — terminal${titleSuffix()}</title>
${faviconTag()}
<link rel="stylesheet" href="/assets/xterm.css"><link rel="stylesheet" href="/assets/style.css">
</head><body class="terminal-page" data-sandbox="${escapeHtml(name)}">
<header class="topbar"><span class="brand">${logoImg(20)}${short}</span>
<span class="muted" data-term-status>connecting…</span><button class="link" data-term-reconnect hidden>Reconnect</button></header>
<div data-term></div>
<script src="/assets/xterm.js"></script><script src="/assets/addon-fit.js"></script><script src="/assets/terminal.js"></script>
</body></html>`)
}
