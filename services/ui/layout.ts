import { readSession, getCookie, SESSION_COOKIE, type Session } from '../session'
import { sandboxPrefix } from '../naming'

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

export function pageSession(req: Request): Session | null {
  return readSession(getCookie(req, SESSION_COOKIE))
}

export function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } })
}

export function html(body: string, status = 200): Response {
  // No framing: a page on another *.<domain> (a sandbox's app) must not wrap ours and steer its clicks or keystrokes
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" } })
}

export function renderPage(opts: { title: string; view: 'mine' | 'all' | 'tokens' | 'ssh-keys'; session: Session; body: string }): string {
  const { title, view, session, body } = opts
  const link = (href: string, label: string, v: string) =>
    `<a href="${href}"${v === view ? ' class="active"' : ''}>${label}</a>`
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Purgatory</title>
<link rel="stylesheet" href="/assets/style.css">
<link rel="icon" href="/assets/logo.svg" type="image/svg+xml">
</head>
<body data-view="${view}" data-role="${session.role}" data-sub="${escapeHtml(session.sub)}" data-prefix="${escapeHtml(sandboxPrefix())}">
<header class="topbar">
  <span class="brand"><img src="/assets/logo.svg" alt="" width="20" height="20">Purgatory</span>
  <nav>
    ${link('/overview', 'Overview', 'overview')}
    ${link('/', 'My sandboxes', 'mine')}
    ${session.role === 'admin' ? link('/admin', 'All sandboxes', 'all') : ''}
    ${link('/settings/tokens', 'Access tokens', 'tokens')}
    ${link('/settings/ssh-keys', 'SSH keys', 'ssh-keys')}
  </nav>
  <form method="post" action="/logout" class="who"><span>${escapeHtml(session.sub)}</span><button class="link">Sign out</button></form>
</header>
<main>${body}</main>
<script src="/assets/panel.js" defer></script>
<script src="/assets/app.js" defer></script>
</body>
</html>`
}

const TOKEN_DIALOG = `
<dialog data-token-dialog>
  <form method="dialog" data-token-form>
    <h2>New access token</h2>
    <label>Name<input name="name" required maxlength="80" placeholder="laptop agent"></label>
    <label>Access<select name="sandbox" data-token-sandbox><option value="">All my sandboxes</option></select></label>
    <small class="muted">A token for one sandbox can use and change only that sandbox; it cannot create or delete sandboxes or manage tokens.</small>
    <label>Expires<select name="expires_in"><option value="30d">in 30 days</option><option value="90d" selected>in 90 days</option><option value="never">never</option></select></label>
    <p class="error" data-token-error hidden></p>
    <div class="actions"><button value="cancel" formnovalidate>Cancel</button><button class="primary" value="create">Create</button></div>
  </form>
</dialog>
<dialog data-token-created>
  <h2>Copy this token now</h2>
  <p class="muted">It will not be shown again.<span data-created-scope></span></p>
  <div class="copy"><code data-created-token></code><button data-copy>Copy</button><button data-download-env>Download p7y.env</button></div>
  <p class="muted">For a coding agent: save p7y.env in your project folder (keep it out of git) and tell the agent: <em>Deploy this app to my Purgatory sandbox — settings in p7y.env.</em></p>
  <form method="dialog"><div class="actions"><button class="primary">Done</button></div></form>
</dialog>`

// Export for coding agents: a zip with a new token for the sandbox, its Docker client keys and a README
const EXPORT_DIALOG = `
<dialog data-export-dialog>
  <form method="dialog" data-export-form>
    <h2>Export for coding agents</h2>
    <p class="muted">A zip with a new token for this sandbox, its Docker client keys and a README with the commands. It is a secret: keep it out of git.</p>
    <label>Token name<input name="name" maxlength="80" placeholder="laptop agent"></label>
    <label>Expires<select name="expires_in"><option value="30d">in 30 days</option><option value="90d" selected>in 90 days</option><option value="never">never</option></select></label>
    <p class="muted" data-export-needs-certs hidden>This sandbox has no Docker access yet: enable it (the sandbox restarts, ~30 s) to include the Docker keys, or export without them.</p>
    <p class="muted" data-export-progress hidden></p>
    <p class="error" data-export-error hidden></p>
    <div class="actions">
      <button value="cancel" formnovalidate>Cancel</button>
      <button value="plain" data-export-plain hidden>Export without Docker access</button>
      <button class="primary" value="enable" data-export-enable hidden>Enable Docker access and export</button>
      <button class="primary" value="download" data-export-download>Download</button>
    </div>
  </form>
</dialog>
<dialog data-env-dialog>
  <h2>p7y.env</h2>
  <p class="muted">Copy this into a <code>p7y.env</code> file in your project (keep it out of git): it holds a new token for this sandbox.</p>
  <textarea data-env-text readonly rows="8" style="width:100%;font:12px ui-monospace,Consolas,monospace"></textarea>
  <form method="dialog"><div class="actions"><button class="primary">Done</button></div></form>
</dialog>`

// Asks before Archive / Revoke. Not the browser's confirm(): that can be switched off or missing
// (embedded browsers), and then answers Cancel at once without showing anything.
// Wake at the running limit: the owner picks which running sandbox sleeps instead
const SWAP_DIALOG = `
<dialog data-swap-dialog>
  <form method="dialog" data-swap-form>
    <h2>Running limit reached</h2>
    <p data-swap-text></p>
    <div data-swap-options></div>
    <p class="error" data-swap-error hidden></p>
    <div class="actions"><button value="cancel" formnovalidate>Cancel</button><button class="primary" value="swap" data-swap-ok>Sleep it and wake</button></div>
  </form>
</dialog>`

const CONFIRM_DIALOG = `
<dialog data-confirm-dialog>
  <form method="dialog">
    <p data-confirm-text></p>
    <div class="actions"><button value="cancel">Cancel</button><button class="danger" value="ok" data-confirm-ok>OK</button></div>
  </form>
</dialog>`

export const OVERVIEW_BODY = `
<div class="ov">
  <div class="ov-head"><h1>Overview</h1><span class="muted" data-ov-scope></span></div>
  <div data-overview><p class="muted">Loading…</p></div>
</div>`

export const SANDBOX_VIEW_BODY = `
<section class="split">
  <div class="list">
    <div class="list-head">
      <h1 data-title></h1>
      <div class="filters" data-admin-only hidden>
        <input type="search" placeholder="Filter by name or owner…" data-filter-text>
        <select data-filter-status><option value="">All statuses</option><option>running</option><option>exited</option><option>deep_sleep</option></select>
      </div>
      <span class="muted" data-quota></span>
      <button class="primary" data-new>+ New sandbox</button>
    </div>
    <table class="grid"><thead data-head></thead><tbody data-rows><tr><td class="muted">Loading…</td></tr></tbody></table>
  </div>
  <aside class="panel" data-panel><p class="muted">Select a sandbox to see its details.</p></aside>
</section>
<dialog data-new-dialog class="wide">
  <form method="dialog" data-new-form>
    <h2>New sandbox</h2>
    <label>Name<input name="name" required pattern="[a-z0-9][a-z0-9_-]{0,62}" placeholder="shop-demo"></label>
    <small class="muted" data-name-hint>lowercase letters, digits, - and _</small>
    <label>Runtime<select name="runtime" data-runtimes></select></label>
    <label>Template<select name="template" data-templates></select></label>
    <label>Compose<br><small class="muted">the stack inside the sandbox: edit the template's, or pick <b>empty</b> and paste your own</small>
      <textarea name="compose" data-compose-editor rows="24" spellcheck="false" autocomplete="off" placeholder="Paste your docker compose file here"></textarea></label>
    <details><summary>Advanced</summary>
      <label>Sleep after no traffic for<input name="idle_timeout" value="30m" pattern="([1-9][0-9]*(s|m|h)|0|off)"></label>
      <label>Deep sleep after asleep for<input name="deep_sleep_after" value="7d" pattern="([1-9][0-9]*(m|h|d)|0|off)"></label>
      <label>CPUs<input name="cpus" inputmode="decimal" placeholder="2"></label>
      <label>Memory<input name="memory" placeholder="4g"></label>
      <small class="muted" data-resource-hint></small>
      <label>Extra SSH public keys <small class="muted">this sandbox only, one per line; your <a href="/settings/ssh-keys">SSH keys</a> always get in</small>
        <textarea name="ssh_keys" rows="3" spellcheck="false" autocomplete="off" placeholder="ssh-ed25519 AAAA… agent@ci"></textarea></label>
      <label class="check"><input type="checkbox" name="create_inner_stack" checked> Deploy the template's stack</label>
    </details>
    <p class="error" data-new-error hidden></p>
    <div class="actions"><button value="cancel" formnovalidate>Cancel</button><button class="primary" value="create">Create</button></div>
  </form>
</dialog>
<dialog data-sleep-dialog>
  <form method="dialog" data-sleep-form>
    <h2>Sleep settings</h2>
    <label>Sleep after no traffic for<input name="idle_timeout" required pattern="([1-9][0-9]*(s|m|h)|0|off)"></label>
    <small class="muted">e.g. 30m or 2h; 0 or off = never. A running sandbox's apps are unreachable for a few seconds while this is applied.</small>
    <label>Deep sleep after asleep for<input name="deep_sleep_after" required pattern="([1-9][0-9]*(m|h|d)|0|off)"></label>
    <small class="muted">e.g. 7d or 12h; 0 or off = never</small>
    <p class="error" data-sleep-error hidden></p>
    <div class="actions"><button value="cancel" formnovalidate>Cancel</button><button class="primary" value="save">Save</button></div>
  </form>
</dialog>
<dialog data-resource-dialog>
  <form method="dialog" data-resource-form>
    <h2>Resources</h2>
    <label>CPUs<input name="cpus" required inputmode="decimal"></label>
    <label>Memory<input name="memory" required placeholder="4g"></label>
    <small class="muted" data-resource-ceiling></small>
    <div data-disk-field hidden><label>Warn above disk use of<input name="disk" placeholder="20g"></label>
    <small class="muted">a warning only: nothing is stopped or refused</small></div>
    <p class="error" data-resource-error hidden></p>
    <div class="actions"><button value="cancel" formnovalidate>Cancel</button><button class="primary" value="save">Save</button></div>
  </form>
</dialog>
<dialog data-connect-dialog class="wide">
  <h2>Connect to <code data-connect-host></code></h2>
  <p class="muted small">TLS only, on port 443. The service's own login protects it (a Postgres password, Redis AUTH…). A sandbox without web traffic still falls asleep after its idle timeout, which drops open connections; the next connection wakes it.</p>
  <p class="small" data-connect-login hidden></p>
  <div data-connect-kind="postgres" hidden><h3>Postgres</h3><pre class="code" data-connect-psql></pre></div>
  <div data-connect-kind="redis" hidden><h3>Redis</h3><pre class="code" data-connect-redis></pre>
    <p class="muted small">Add <code>--insecure</code> if the server uses a self-signed certificate.</p></div>
  <div data-connect-kind="ssh" hidden><h3>SSH</h3><pre class="code" data-connect-ssh-cmd></pre>
    <h3>SSH (~/.ssh/config)</h3><pre class="code" data-connect-ssh></pre>
    <p class="muted small">Needs <code>openssl</code> next to <code>ssh</code> (on Windows: Git Bash).</p></div>
  <h3>Any TLS client</h3><pre class="code" data-connect-openssl></pre>
  <div class="actions"><form method="dialog"><button class="primary">Close</button></form></div>
</dialog>
<dialog data-compose-dialog class="wide">
  <h2>Starter stack of <span data-compose-name></span></h2>
  <p class="muted small">What Purgatory deployed into the sandbox when it was created. Stacks you deployed yourself are in Portainer.</p>
  <pre class="code" data-compose-text>Loading…</pre>
  <p class="muted small">Secrets are masked (•••).</p>
  <div class="actions"><button data-compose-copy>Copy</button><form method="dialog"><button class="primary">Close</button></form></div>
</dialog>${TOKEN_DIALOG}${EXPORT_DIALOG}${CONFIRM_DIALOG}${SWAP_DIALOG}`

export const SSH_KEYS_VIEW_BODY = `
<section class="tokens">
  <div class="list-head"><h1>SSH keys</h1></div>
  <p class="muted">Your public keys let you into your sandboxes as root: <code>ssh root@&lt;sandbox&gt;-shell-tcp.&lt;domain&gt;</code> through port 443 (Connect… in a sandbox's panel). Adding or deleting a key takes effect at once.</p>
  <table class="grid"><thead><tr><th>Name</th><th>Type</th><th>Fingerprint</th><th>Added</th><th></th></tr></thead><tbody data-ssh-key-rows><tr><td class="muted" colspan="5">Loading…</td></tr></tbody></table>
  <form data-ssh-key-form>
    <h2>Add a key</h2>
    <label>Name <small class="muted">optional; defaults to the key's comment</small><input name="name" maxlength="80" placeholder="laptop"></label>
    <label>Public key <small class="muted">the contents of e.g. ~/.ssh/id_ed25519.pub</small><textarea name="key" rows="3" required spellcheck="false" placeholder="ssh-ed25519 AAAA… me@laptop"></textarea></label>
    <p class="error" data-ssh-key-error hidden></p>
    <div class="actions"><button class="primary">Add key</button></div>
  </form>
</section>${CONFIRM_DIALOG}`

export const TOKENS_VIEW_BODY = `
<section class="tokens">
  <div class="list-head"><h1>Access tokens</h1><button class="primary" data-new-token>+ New token</button></div>
  <p class="muted">Give a token to your own agents: they act on the API as you (<code>Authorization: Bearer p7y_…</code>). A token can be limited to one sandbox.</p>
  <table class="grid"><thead data-token-head></thead><tbody data-token-rows><tr><td class="muted">Loading…</td></tr></tbody></table>
</section>${TOKEN_DIALOG}${EXPORT_DIALOG}${CONFIRM_DIALOG}`
