// The /activate card (approving a /p9m:init code), shared by its GET and POST
import { escapeHtml, html } from './layout'
import { brandTitle, faviconTag, logoImg } from './brand'
import { rawNameOf, sandboxName } from '../naming'
import { normalizeUserCode } from '../deviceAuth'

/** The full name of what the agent sent: the short name the user sees, or already the full one */
export const fullSandboxName = (s: string) => rawNameOf(s) !== null ? s : sandboxName(s)

/** XXXX-XXXX, as the agent showed it */
export function displayCode(input: string): string {
  const c = normalizeUserCode(input)
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c
}

/** The card; body is HTML (escape what goes in it) */
export function activatePage(body: string, status = 200): Response {
  const name = brandTitle()
  return html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect Claude Code${name ? ` — ${escapeHtml(name)}` : ''}</title><link rel="stylesheet" href="/assets/style.css">
${faviconTag()}</head>
<body class="login">
<div class="heat"></div>
<div class="card">
  ${logoImg(56, 'logo')}
  <h1>Connect Claude Code</h1>
  ${body}
</div>
<script src="/assets/embers.js" defer></script>
</body></html>`, status)
}

export const expiredPage = () => activatePage('<p class="error">This code has expired or is unknown: run /p9m:init again.</p>', 404)
export const messagePage = (text: string, status = 200, cls = 'muted') => activatePage(`<p class="${cls}">${escapeHtml(text)}</p>`, status)
