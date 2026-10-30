import { escapeHtml, html, pageSession, redirect } from '../../services/ui/layout'
import { oidcEnabled, providerName } from '../../services/oidc'
import { capacityHtml, loginCapacity } from '../../services/loginCapacity'
import { brandTitle, faviconTag, logoImg } from '../../services/ui/brand'
import { adminLoginEnabled } from '../../services/loginGuard'
import { isUserHost } from '../../services/userHost'

export default async (req: Request): Promise<Response> => {
  if (pageSession(req)) return redirect('/')
  const error = new URL(req.url).searchParams.get('error')
  // Off (the default): the form is not there at all; nor on the users' address (USER_HOST), the admin's is UI_HOST
  const adminEnabled = adminLoginEnabled() && !isUserHost(req.headers.get('host'))
  const capacity = capacityHtml(await loginCapacity.get())
  const name = brandTitle()
  return html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in${name ? ` — ${escapeHtml(name)}` : ''}</title><link rel="stylesheet" href="/assets/style.css">
${faviconTag()}</head>
<body class="login">
<div class="heat"></div>
<div class="card">
  ${logoImg(56, 'logo')}
  ${name ? `<h1>${escapeHtml(name)}</h1>` : ''}
  <p class="muted">Your own Docker sandboxes.</p>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
  ${capacity}
  ${oidcEnabled() ? `<a class="primary wide" href="/auth/oidc">Sign in with ${escapeHtml(providerName())}</a>` : ''}
  ${adminEnabled ? `<details${oidcEnabled() ? '' : ' open'}><summary>Administrator sign-in</summary>
  <form method="post" action="/login">
    <label>Username<input name="username" autocomplete="username" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <button class="primary wide">Sign in</button>
  </form></details>` : ''}
  ${!oidcEnabled() && !adminEnabled ? '<p class="error">No sign-in method is on: set up OIDC, or for the admin ADMIN_LOGIN=on.</p>' : ''}
</div>
<p class="about-foot"><a href="/about">About · AGPL-3.0</a></p>
<script src="/assets/embers.js" defer></script>
</body></html>`)
}
