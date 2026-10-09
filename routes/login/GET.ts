import { escapeHtml, html, pageSession, redirect } from '../../services/ui/layout'
import { oidcEnabled, providerName } from '../../services/oidc'
import { capacityHtml, loginCapacity } from '../../services/loginCapacity'

export default async (req: Request): Promise<Response> => {
  if (pageSession(req)) return redirect('/')
  const error = new URL(req.url).searchParams.get('error')
  const adminEnabled = !!(process.env.ADMIN_USER && process.env.ADMIN_PASSWORD)
  const capacity = capacityHtml(await loginCapacity.get())
  return html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — Purgatory</title><link rel="stylesheet" href="/assets/style.css">
<link rel="icon" href="/assets/logo.svg" type="image/svg+xml"></head>
<body class="login">
<div class="heat"></div>
<div class="card">
  <img class="logo" src="/assets/logo.svg" alt="" width="56" height="56">
  <h1>Purgatory</h1>
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
  ${!oidcEnabled() && !adminEnabled ? '<p class="error">No sign-in method is configured.</p>' : ''}
</div>
<script src="/assets/embers.js" defer></script>
</body></html>`)
}
