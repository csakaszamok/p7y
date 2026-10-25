import { pageSession, redirect, html, escapeHtml, htmlTag } from '../../../../services/ui/layout'
import { getOwnedSandbox } from '../../../../services/access'
import { rawNameOf } from '../../../../services/naming'
import { faviconTag, logoImg, titleSuffix } from '../../../../services/ui/brand'

/** The logs page; it reads /sandboxes/:name/logs/stream. */
export default async (req: Request): Promise<Response> => {
  const session = pageSession(req)
  if (!session) return redirect('/login')
  let name: string
  try { name = decodeURIComponent(new URL(req.url).pathname.split('/')[2]) } catch { return html('<p>Sandbox not found.</p>', 404) }
  try { await getOwnedSandbox({ sub: session.sub, role: session.role, via: 'session' }, name) } catch { return html('<p>Sandbox not found.</p>', 404) }
  const short = escapeHtml(rawNameOf(name) ?? name)
  return html(`<!DOCTYPE html>
${htmlTag(session.sub)}<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${short} — logs${titleSuffix()}</title>
${faviconTag()}
<link rel="stylesheet" href="/assets/style.css">
</head><body class="logs-page" data-sandbox="${escapeHtml(name)}">
<header class="topbar"><span class="brand">${logoImg(20)}${short} — logs</span>
<span class="muted" data-log-status>connecting…</span>
<button class="link" data-log-start hidden>Start</button><button class="link" data-log-reconnect hidden>Reconnect</button>
<span class="log-tools"><select data-log-filter aria-label="Service"><option value="">All services</option></select>
<button data-log-pause>Pause</button><button data-log-clear>Clear</button></span></header>
<div data-log></div>
<button class="log-newer" data-log-newer hidden>↓ new lines</button>
<script src="/assets/logs.js"></script>
</body></html>`)
}
