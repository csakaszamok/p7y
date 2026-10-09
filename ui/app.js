// Purgatory UI: one script for the sandbox views ("mine", "all") and the tokens view.
const view = document.body.dataset.view
const isAdmin = document.body.dataset.role === 'admin'
const me = document.body.dataset.sub
const $ = sel => document.querySelector(sel)
// Shared with the details panel (ui/panel.js, loaded first)
const { esc, remaining, countdown, statusLabel, statusClass, fmtBytes, meter } = window.P7yPanel

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin'
  })
  if (res.status === 401) { location.href = '/login'; throw new Error('signed out') }
  const body = await res.json().catch(() => ({}))
  // The body travels with the error: a refused wake names the running sandboxes to choose from
  if (!res.ok) { const err = new Error(body.error || `HTTP ${res.status}`); err.body = body; throw err }
  return body
}

// New sandboxes are <prefix>-<name> (p7y by default); legacy ones leander-<name>.
const prefix = document.body.dataset.prefix || 'p7y'
const shortName = n => n.startsWith(`${prefix}-`) ? n.slice(prefix.length + 1) : n.replace(/^leander-/, '')
const age = iso => {
  const t = Date.parse(iso); if (isNaN(t)) return ''
  // The browser's clock can be a little behind the server's: never show a negative age
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000))
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`
}

// ---------- sleep countdown ----------
// The server says how much time is left (stops_in, deep_sleep_in: seconds by its own clock). Count down
// from when that answer arrived, so a browser clock that is ahead or behind does not shift the countdown.
function onLocalClock(s) {
  const at = secs => secs == null ? null : new Date(Date.now() + secs * 1000).toISOString()
  const { stops_in, deep_sleep_in, ...rest } = s
  return {
    ...rest,
    stops_at: stops_in !== undefined ? at(stops_in) : s.stops_at,
    deep_sleep_at: deep_sleep_in !== undefined ? at(deep_sleep_in) : s.deep_sleep_at,
  }
}

// Compact variants for the table.
function sleepCell(s) {
  if (s.idle_timeout === 'off') return '<span class="muted">never</span>'
  if (s.status !== 'running') return '<span class="muted">—</span>'
  return s.stops_at ? countdown(s.stops_at) : '<span class="muted">no traffic yet</span>'
}

function deepSleepCell(s) {
  if (s.deep_sleep_after === 'off') return '<span class="muted">never</span>'
  if (s.status === 'exited' && s.deep_sleep_at) return countdown(s.deep_sleep_at)
  if (s.status === 'running' && s.deep_sleep_after) return `<span class="muted">${esc(s.deep_sleep_after)} after sleep</span>`
  return '<span class="muted">—</span>'
}

// Update countdown text in place every second (no panel re-render).
setInterval(() => {
  for (const el of document.querySelectorAll('[data-until]')) el.textContent = remaining(el.dataset.until)
}, 1000)

// ---------- sandboxes ----------
let sandboxes = []
let selected = null
const pending = new Set()
let renderedName = null, renderedJSON = null

function filtered() {
  // An admin's /sandboxes response includes everyone's sandboxes; "My
  // sandboxes" must only ever show the admin's own, or they could act on
  // someone else's sandbox believing it is theirs.
  if (view === 'mine') return isAdmin ? sandboxes.filter(s => s.owner === document.body.dataset.sub) : sandboxes
  if (view !== 'all') return sandboxes
  const text = ($('[data-filter-text]').value || '').toLowerCase()
  const status = $('[data-filter-status]').value
  return sandboxes.filter(s =>
    (!text || s.name.includes(text) || (s.owner || '').toLowerCase().includes(text)) && (!status || s.status === status))
}

function renderRows() {
  const cols = view === 'all'
    ? ['Name', 'Owner', 'Status', 'Sleeps in', 'Deep sleep in', 'CPU · Mem', 'Template', 'Created']
    : ['Name', 'Status', 'Sleeps in', 'Deep sleep in', 'CPU · Mem', 'Template', 'Created']
  $('[data-head]').innerHTML = `<tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>`
  const rows = [...filtered()]
  for (const name of pending) if (!rows.some(s => s.name === name)) rows.unshift({ name, status: 'starting', runtime: '', template: '', created_at: '' })
  $('[data-rows]').innerHTML = rows.length ? rows.map(s => `
    <tr data-name="${esc(s.name)}" class="${s.name === selected ? 'selected' : ''}">
      <td><strong>${esc(shortName(s.name))}</strong></td>
      ${view === 'all' ? `<td>${esc(s.owner === 'admin' ? 'admin API' : s.owner)}</td>` : ''}
      <td>${busy.has(s.name)
        ? `<span class="status starting">${esc(ACTIONS[busy.get(s.name)].row)}</span>`
        : `<span class="status ${esc(statusClass(s))}">${esc(s.start_error ? 'failed to start' : statusLabel(s.status))}</span>`}</td>
      <td>${sleepCell(s)}</td>
      <td>${deepSleepCell(s)}</td>
      <td>${usageCell(s)}</td>
      <td>${esc([s.runtime, s.template].filter(Boolean).join(' · '))}${s.compose === 'edited' ? ' <span class="muted">(edited)</span>' : ''}</td>
      <td>${esc(age(s.created_at))}</td>
    </tr>`).join('') : `<tr><td class="muted" colspan="${cols.length}">No sandboxes yet — create one.</td></tr>`
}

async function loadQuota() {
  if (view !== 'mine') return
  try {
    const me = await api('/me')
    meInfo = me
    showResourceHint()
    const el = $('[data-quota]')
    if (me.quota === null) { el.textContent = ''; $('[data-new]').disabled = false; return }
    // Running and asleep sandboxes hold a slot; deep sleep frees it
    // The quota counts running sandboxes; asleep and deep-sleeping ones are free
    el.textContent = `Running ${me.sandbox_count} / ${me.quota}`
    // The server limit (SANDBOX_MAX_TOTAL) can stop a user under their own quota
    if (me.server_full) { $('[data-new]').disabled = true; $('[data-new]').title = 'The server is full: ask the administrator'; return }
    $('[data-new]').disabled = me.sandbox_count >= me.quota
    $('[data-new]').title = me.sandbox_count >= me.quota ? 'Running limit reached: put a sandbox to sleep first' : ''
  } catch (e) { if (e.message !== 'signed out') console.error(e) }
}

// ---------- overview ----------
async function loadOverview() {
  try {
    const [sum, list] = await Promise.all([api('/sandboxes/summary'), api('/sandboxes')])
    // The admin's /sandboxes is everyone's: the server view; a user's is their own
    $('[data-ov-scope]').textContent = isAdmin ? 'the whole server' : 'your sandboxes'
    $('[data-overview]').innerHTML = P7yPanel.overviewHtml(sum, list, { isAdmin, shortName })
  } catch (e) { if (e.message !== 'signed out') $('[data-overview]').innerHTML = `<p class="error">${esc(e.message)}</p>` }
}
function initOverview() {
  loadOverview()
  setInterval(() => { if (!document.hidden) loadOverview() }, 10_000)
}

async function loadList() {
  try {
    sandboxes = (await api('/sandboxes')).map(onLocalClock)
    for (const s of sandboxes) pending.delete(s.name)
    renderRows()
    loadQuota()
  } catch (e) { if (e.message !== 'signed out') console.error(e) }
}

// ---------- panel tabs ----------
const TAB_KEY = 'p7y.panelTab'
let panelTab = (() => { try { return localStorage.getItem(TAB_KEY) || 'apps' } catch { return 'apps' } })()
function selectTab(tab, focus = false) {
  if (!P7yPanel.TABS.some(([id]) => id === tab)) tab = 'apps'
  panelTab = tab
  try { localStorage.setItem(TAB_KEY, tab) } catch { /* no storage: remembered for this page only */ }
  const panel = $('[data-panel]')
  for (const t of panel.querySelectorAll('[role="tab"]')) {
    const on = t.dataset.tab === tab
    t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1
    if (on && focus) t.focus()
  }
  for (const p of panel.querySelectorAll('[role="tabpanel"]')) p.hidden = p.dataset.tabpanel !== tab
  if (tab === 'registry' && selected) void loadRegistry(selected)
}

// The Registry tab: the sandbox's images and their secret-scan results
async function loadRegistry(name) {
  const box = $('[data-panel] [data-registry]')
  if (!box) return
  try {
    const data = await api(`/sandboxes/${encodeURIComponent(name)}/registry`)
    if (selected === name && box.isConnected) box.innerHTML = P7yPanel.registryTable(data)
  } catch (e) { if (box.isConnected) box.innerHTML = `<p class="error">${esc(e.message)}</p>` }
}
async function deleteVersion(b) {
  const name = selected
  const { deleteApp: app, deleteDigest: digest } = b.dataset
  if (!name || !await confirmDialog(`Delete ${app} (${digest.slice(7, 19)}) from the registry?`, 'Delete')) return
  try { await api(`/sandboxes/${encodeURIComponent(name)}/registry/${encodeURIComponent(app)}/${encodeURIComponent(digest)}`, { method: 'DELETE' }); await loadRegistry(name) }
  catch (e) { const err = $('[data-act-error]'); err.textContent = e.message; err.hidden = false }
}

// ---------- export for coding agents ----------
// A new token for the sandbox as p7y.env text, to the clipboard (or shown to copy by hand without one)
async function copyEnv(name) {
  const b = $('[data-panel] [data-act="copy-env"]')
  // It may wake the sandbox to make its Portainer token: seconds, not instant
  if (b) { b.disabled = true; b.textContent = 'Preparing…' }
  try {
    const res = await fetch(`/sandboxes/${encodeURIComponent(name)}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ format: 'env', name: `copied ${new Date().toISOString().slice(0, 10)}`, expires_in: '90d' }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
    const text = await res.text()
    const skipped = res.headers.get('X-P7y-Portainer')
    try {
      await navigator.clipboard.writeText(text)
      if (b) { b.textContent = skipped ? 'Copied, without Portainer' : 'Copied'; b.title = skipped || ''; setTimeout(() => { b.textContent = 'Copy as .env' }, skipped ? 4000 : 1500) }
    } catch {
      const dlg = $('[data-env-dialog]'), box = $('[data-env-text]')
      box.value = text; dlg.showModal(); box.select()
    }
  } catch (e) { if (b) b.textContent = 'Copy as .env'; const err = $('[data-act-error]'); err.textContent = e.message; err.hidden = false } finally { if (b) b.disabled = false }
}
function openExportDialog(name) {
  const dlg = $('[data-export-dialog]')
  if (!dlg) return void location.reload()
  dlg.dataset.sandbox = name
  let ready = false
  try { ready = JSON.parse(renderedJSON || '{}').docker_access?.state === 'ready' } catch { /* not rendered yet */ }
  $('[data-export-needs-certs]').hidden = ready
  $('[data-export-enable]').hidden = ready
  $('[data-export-plain]').hidden = ready
  $('[data-export-download]').hidden = !ready
  $('[data-export-error]').hidden = true
  $('[data-export-progress]').hidden = true
  dlg.showModal()
}
function initExportDialog() {
  const form = $('[data-export-form]')
  if (!form) return
  form.addEventListener('submit', async ev => {
    const how = ev.submitter?.value
    if (!['download', 'plain', 'enable'].includes(how)) return
    ev.preventDefault()
    const dlg = $('[data-export-dialog]'), name = dlg.dataset.sandbox, btn = ev.submitter
    const progress = $('[data-export-progress]')
    for (const b of form.querySelectorAll('button')) b.disabled = true
    try {
      if (how === 'enable') {
        progress.textContent = 'Enabling Docker access: the sandbox restarts…'; progress.hidden = false
        await api(`/sandboxes/${encodeURIComponent(name)}/docker-keys`, { method: 'POST' })
        renderedJSON = null; void showPanel(name)
      }
      const body = { ...Object.fromEntries(new FormData(form)), docker: how !== 'plain' }
      const res = await fetch(`/sandboxes/${encodeURIComponent(name)}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(await res.blob())
      a.download = `p7y-${shortName(name)}.zip`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      dlg.close(); form.reset()
    } catch (e) { const err = $('[data-export-error]'); err.textContent = e.message; err.hidden = false } finally { progress.hidden = true; for (const b of form.querySelectorAll('button')) b.disabled = false; void btn }
  })
}
async function copyText(b) {
  try {
    await navigator.clipboard.writeText(b.dataset.copyText)
    b.dataset.label ??= b.textContent
    b.textContent = 'Copied'; clearTimeout(b._copied); b._copied = setTimeout(() => { b.textContent = b.dataset.label }, 1500)
  } catch {
    // No clipboard (plain HTTP): select the text next to the button for Ctrl+C
    const el = b.parentElement.querySelector('.tcp, [data-secret]:not([hidden])')
    if (el) { const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r) }
  }
}

async function showPanel(name) {
  selected = name
  renderRows()
  const panel = $('[data-panel]')
  if (pending.has(name)) { panel.innerHTML = `<h2>${esc(shortName(name))}</h2><p class="muted">Creating… this takes 20–60 s.</p>`; renderedName = name; renderedJSON = null; return }
  let s
  try { s = await api(`/sandboxes/${encodeURIComponent(name)}`) } catch (e) { panel.innerHTML = `<p class="error">${esc(e.message)}</p>`; renderedJSON = null; return }
  if (selected !== name) return
  // Compare without the seconds left and the CPU/memory use, which change on every poll: re-render only when something else changed
  const sJSON = JSON.stringify({ ...s, stops_in: undefined, deep_sleep_in: undefined, usage: undefined })
  s = onLocalClock(s)
  if (renderedName === name && renderedJSON === sJSON) {
    const cell = panel.querySelector('[data-resources]') // only the use changed: update just its meters
    if (cell) cell.innerHTML = P7yPanel.resourcesTable(s)
    return
  }
  renderedName = name
  renderedJSON = sJSON
  panel.innerHTML = P7yPanel.renderPanel(s, { isAdmin, me, shortName, tab: panelTab, protocol: location.protocol })
  if (panelTab === 'registry') void loadRegistry(name)
  if (busy.has(name)) markBusy(panel, busy.get(name))
}

// The lifecycle actions, in the words of the lifecycle: sleep, deep sleep, wake, archive.
// "busy" and "status" are shown while the call runs, which can take a while (archiving: minutes).
const ACTIONS = {
  stop: { label: 'Sleep', busy: 'Going to sleep…', status: 'going to sleep…', row: 'going to sleep…' },
  'deep-sleep': { label: 'Deep sleep', busy: 'Going into deep sleep…', status: 'going into deep sleep…', row: 'going into deep sleep…' },
  start: { label: 'Wake', busy: 'Waking…', status: 'waking… (from deep sleep this takes up to a minute)', row: 'waking…' },
  delete: { label: 'Archive…', busy: 'Archiving…', status: 'archiving… with large volumes this can take a few minutes', row: 'archiving…' },
}
const actButton = a => `<button data-act="${a}">${ACTIONS[a].label}</button>`

function lifecycleButtons(s) {
  if (s.status === 'running') return actButton('stop') + actButton('deep-sleep')
  if (s.status === 'deep_sleep') return actButton('start')
  return actButton('start') + actButton('deep-sleep') // asleep, created, failed
}

// Resolves true for OK, false for Cancel, Esc or a click outside the buttons
function confirmDialog(text, okLabel) {
  const dlg = $('[data-confirm-dialog]')
  dlg.querySelector('[data-confirm-text]').textContent = text
  dlg.querySelector('[data-confirm-ok]').textContent = okLabel
  dlg.returnValue = ''
  return new Promise(resolve => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true })
    dlg.showModal()
  })
}

// Sandboxes with an action running (archiving can take minutes): another sandbox can be acted on
// meanwhile; the 5 s refresh leaves a busy sandbox's panel alone
const busy = new Map() // sandbox name → the action running on it

// The panel while an action runs: buttons off, the pressed one and the status say what is happening
function markBusy(panel, action) {
  // Every action, in every tab (some sit in table cells, not in an .actions row)
  for (const b of panel.querySelectorAll('button[data-act], button[data-connect]')) b.disabled = true
  const pressed = panel.querySelector(`[data-act="${action}"]`)
  if (pressed) { pressed.textContent = ACTIONS[action].busy; pressed.classList.add('busy') }
  const pill = panel.querySelector('.status')
  if (pill) { pill.className = 'status starting'; pill.textContent = ACTIONS[action].status }
}

async function act(action) {
  const name = selected
  if (!name || busy.has(name)) return
  if (action === 'terminal') return void window.open(`/sandboxes/${encodeURIComponent(name)}/terminal`, '_blank')
  if (action === 'logs') return void window.open(`/sandboxes/${encodeURIComponent(name)}/logs`, '_blank')
  if (action === 'ssh-key') {
    try { await api(`/sandboxes/${encodeURIComponent(name)}/ssh-key`, { method: 'POST' }); renderedJSON = null; showPanel(name) }
    catch (e) { const err = $('[data-act-error]'); err.textContent = e.message; err.hidden = false }
    return
  }
  if (action === 'keep-awake') {
    const btn = $('[data-panel] [data-act="keep-awake"]')
    if (btn) { btn.disabled = true; btn.textContent = 'Resetting…' }
    try { await api(`/sandboxes/${encodeURIComponent(name)}/keep-awake`, { method: 'POST' }); renderedJSON = null; await showPanel(name) }
    catch (e) { const err = $('[data-act-error]'); err.textContent = e.message; err.hidden = false; if (btn) { btn.disabled = false; btn.textContent = 'Reset' } }
    return
  }
  if (action === 'export') return openExportDialog(name)
  if (action === 'copy-env') return copyEnv(name)
  if (action === 'enable-docker' || action === 'rotate-docker-keys') {
    const rotate = action === 'rotate-docker-keys'
    const q = rotate
      ? `New Docker keys for ${shortName(name)}? Earlier exports stop working; the sandbox restarts (~30 s).`
      : `Enable Docker access for ${shortName(name)}? The sandbox restarts (~30 s).`
    if (!await confirmDialog(q, rotate ? 'Rotate' : 'Enable')) return
    try { await api(`/sandboxes/${encodeURIComponent(name)}/docker-keys`, { method: 'POST' }); renderedJSON = null; await showPanel(name) }
    catch (e) { const err = $('[data-act-error]'); err.textContent = e.message; err.hidden = false }
    return
  }
  if (action === 'sleep') return openSleepDialog()
  if (action === 'resources') return openResourceDialog()
  if (action === 'token') return $('[data-token-dialog]') ? openTokenDialog(name) : location.reload()
  if (action === 'compose') return $('[data-compose-dialog]') ? openComposeDialog(name) : location.reload()
  if (action === 'delete' && !await confirmDialog(`Archive ${shortName(name)}? It disappears from the list; its configuration and data are kept in the archive.`, 'Archive')) return
  if (busy.has(name)) return // the same action started while the question was open
  const panel = $('[data-panel]')
  busy.set(name, action)
  markBusy(panel, action)
  renderRows()
  $('[data-act-error]').hidden = true
  try {
    if (action === 'delete') await api(`/sandboxes/${encodeURIComponent(name)}`, { method: 'DELETE' })
    else await api(`/sandboxes/${encodeURIComponent(name)}/${action}`, { method: 'POST' })
    busy.delete(name)
    // The user may have moved on to another sandbox meanwhile: its panel is not ours to change
    if (action === 'delete' && selected === name) { selected = null; panel.innerHTML = `<p class="muted">${esc(shortName(name))} is archived.</p>`; renderedName = null; renderedJSON = null }
    await loadList()
    if (selected === name) { renderedJSON = null; await showPanel(name) }
  } catch (e) {
    // At the running limit: let the owner choose which running sandbox sleeps instead
    if (action === 'start' && e.body?.reason === 'running') { busy.delete(name); renderRows(); if (selected === name) { renderedJSON = null; await showPanel(name) } return openSwapDialog(name, e.body.running, e.body.limit) }
    busy.delete(name)
    renderRows()
    if (selected !== name) {
      // shown in the panel the user is on now, saying which sandbox it is about
      await loadList()
      const err = $('[data-act-error]')
      if (err) { err.textContent = `${shortName(name)}: ${e.message}`; err.hidden = false }
      return
    }
    renderedJSON = null
    await showPanel(name)
    const err = $('[data-act-error]')
    if (err) { err.textContent = e.message; err.hidden = false }
  }
}

// ---------- SSH keys ----------
async function loadSshKeys() {
  const rows = $('[data-ssh-key-rows]')
  try {
    const keys = await api('/ssh-keys')
    rows.innerHTML = keys.length ? keys.map(k => `<tr>
      <td>${esc(k.name)}</td><td>${esc(k.type)}</td><td><code>${esc(k.fingerprint)}</code></td><td>${esc(new Date(k.created_at).toLocaleDateString())}</td>
      <td><button class="danger" data-delete-key="${esc(k.id)}" data-key-name="${esc(k.name)}">Delete</button></td></tr>`).join('')
      : '<tr><td class="muted" colspan="5">No keys yet: add one below to SSH into your sandboxes.</td></tr>'
  } catch (e) { rows.innerHTML = `<tr><td class="error" colspan="5">${esc(e.message)}</td></tr>` }
}

function initSshKeys() {
  const form = $('[data-ssh-key-form]')
  form.addEventListener('submit', async ev => {
    ev.preventDefault()
    const err = $('[data-ssh-key-error]')
    err.hidden = true
    const data = Object.fromEntries(new FormData(form))
    try {
      await api('/ssh-keys', { method: 'POST', body: JSON.stringify({ key: data.key, ...(data.name ? { name: data.name } : {}) }) })
      form.reset()
      loadSshKeys()
    } catch (e) { err.textContent = e.message; err.hidden = false }
  })
  $('[data-ssh-key-rows]').addEventListener('click', async e => {
    const b = e.target.closest('button[data-delete-key]'); if (!b) return
    if (!await confirmDialog(`Delete the key ${b.dataset.keyName}? It stops letting you into your sandboxes at once.`, 'Delete')) return
    try { await api(`/ssh-keys/${encodeURIComponent(b.dataset.deleteKey)}`, { method: 'DELETE' }); loadSshKeys() } catch (err) { alert(err.message) }
  })
  loadSshKeys()
}

// ---------- TCP connect dialog ----------
// The container's own port says which service it is; anything else gets only the generic TLS recipe
const CONNECT_KINDS = { 5432: 'postgres', 6379: 'redis', 22: 'ssh', 2222: 'ssh' }
function openConnectDialog(hostPort, { port, user, demoPassword, keyFile } = {}) {
  const host = hostPort.replace(/:443$/, '')
  const kind = CONNECT_KINDS[port]
  $('[data-connect-host]').textContent = hostPort
  for (const el of document.querySelectorAll('[data-connect-kind]')) el.hidden = el.dataset.connectKind !== kind
  const login = $('[data-connect-login]')
  const parts = [user && `User: <code>${esc(user)}</code>`,
    demoPassword && `Password: <code data-secret hidden>${esc(demoPassword)}</code> <button class="link" data-show>show</button>`].filter(Boolean)
  login.innerHTML = parts.join(' · ')
  login.hidden = !parts.length
  $('[data-connect-psql]').textContent = `psql "host=${host} port=443 sslmode=require user=${user || 'postgres'} dbname=postgres"`
  $('[data-connect-redis]').textContent = `redis-cli -h ${host} -p 443 --tls --sni ${host}${user ? ` --user ${user}` : ''} -a <password>`
  // With the sandbox's generated key (Download key saves it as <name>.key)
  const keyPath = keyFile ? `~/Downloads/${keyFile}` : ''
  $('[data-connect-ssh-cmd]').textContent = `${keyPath ? `chmod 600 ${keyPath}\n` : ''}ssh ${keyPath ? `-i ${keyPath} ` : ''}-o ProxyCommand="openssl s_client -quiet -connect %h:443 -servername %h" ${user || '<user>'}@${host}`
  $('[data-connect-ssh]').textContent = `Host ${host.split('.')[0]}
  HostName ${host}
  User ${user || '<user>'}${keyPath ? `\n  IdentityFile ${keyPath}` : ''}
  ProxyCommand openssl s_client -quiet -connect %h:443 -servername %h`
  $('[data-connect-openssl]').textContent = `openssl s_client -quiet -connect ${host}:443 -servername ${host}`
  $('[data-connect-dialog]').showModal()
}

// ---------- starter stack viewer ----------
async function openComposeDialog(name) {
  $('[data-compose-name]').textContent = shortName(name)
  $('[data-compose-text]').textContent = 'Loading…'
  $('[data-compose-dialog]').showModal()
  try {
    const { starter } = await api(`/sandboxes/${encodeURIComponent(name)}/compose`)
    $('[data-compose-text]').textContent = starter ?? 'No starter stack was deployed into this sandbox.'
  } catch (e) { $('[data-compose-text]').textContent = e.message }
}

function initComposeDialog() {
  if (!$('[data-compose-dialog]')) return
  $('[data-compose-copy]').addEventListener('click', async e => {
    await navigator.clipboard.writeText($('[data-compose-text]').textContent)
    e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy' }, 1500)
  })
}

// ---------- sleep settings ----------
// ---------- CPU and memory ----------
let meInfo = null // GET /me: defaults, ceiling (and the host for the admin) for the forms
const GB = 1024 ** 3
const memInput = b => b % GB === 0 ? `${b / GB}g` : `${Math.round(b / 1024 ** 2)}m`
function usageCell(s) {
  const disk = s.disk?.over ? ` <span class="warn" title="over its disk limit: ${fmtBytes(s.disk.used)} of ${fmtBytes(s.disk.limit)}">⚠ disk</span>` : ''
  if (s.status !== 'running' || !s.usage || !s.limits) return disk ? disk.trim() : '<span class="muted">—</span>'
  return `${Math.round(s.usage.cpu / s.limits.cpus * 100)}% · ${fmtBytes(s.usage.memory)}${disk}`
}
function ceilingText() {
  const r = meInfo?.resources
  if (!r) return ''
  return r.host ? `up to the host: ${r.host.cpus} CPUs, ${fmtBytes(r.host.memory)}` : `up to ${r.ceiling.cpus} CPUs and ${fmtBytes(r.ceiling.memory)}`
}
function showResourceHint() {
  const r = meInfo?.resources
  const hint = $('[data-resource-hint]')
  if (!r || !hint) return
  const form = $('[data-new-form]')
  form.cpus.placeholder = String(r.defaults.cpus)
  form.memory.placeholder = memInput(r.defaults.memory)
  hint.textContent = `default ${r.defaults.cpus} CPUs and ${fmtBytes(r.defaults.memory)}; ${ceilingText()}`
}
function openResourceDialog() {
  const s = renderedJSON && JSON.parse(renderedJSON)
  const l = s?.limits || meInfo?.resources?.defaults
  const form = $('[data-resource-form]')
  form.cpus.value = l ? String(l.cpus) : ''
  form.memory.value = l ? memInput(l.memory) : ''
  // What it opened with: only the fields changed are sent (an untouched one is not checked against the ceiling again)
  form.dataset.cpus = form.cpus.value
  form.dataset.memory = form.memory.value
  // The disk limit only warns, so only the admin sets it
  const admin = !!meInfo?.resources?.host
  $('[data-disk-field]').hidden = !admin
  form.disk.value = admin && s?.disk ? memInput(s.disk.limit) : ''
  form.dataset.disk = form.disk.value
  $('[data-resource-ceiling]').textContent = ceilingText()
  $('[data-resource-error]').hidden = true
  $('[data-resource-dialog]').showModal()
}
async function submitResources(ev) {
  if (ev.submitter?.value !== 'save') return
  ev.preventDefault()
  const name = selected
  const form = ev.target
  const change = {}
  if (form.cpus.value.trim() !== form.dataset.cpus) change.cpus = form.cpus.value.trim()
  if (form.memory.value.trim() !== form.dataset.memory) change.memory = form.memory.value.trim()
  if (!$('[data-disk-field]').hidden && form.disk.value.trim() && form.disk.value.trim() !== form.dataset.disk) change.disk = form.disk.value.trim()
  if (!Object.keys(change).length) { $('[data-resource-dialog]').close(); return }
  const btn = ev.submitter
  btn.disabled = true
  try {
    await api(`/sandboxes/${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify(change) })
    $('[data-resource-dialog]').close()
    await loadList()
    if (selected === name) { renderedJSON = null; showPanel(name) }
  } catch (e) {
    const err = $('[data-resource-error]'); err.textContent = e.message; err.hidden = false
  } finally { btn.disabled = false }
}

function openSleepDialog() {
  const s = renderedJSON && JSON.parse(renderedJSON)
  const form = $('[data-sleep-form]')
  form.idle_timeout.value = s?.idle_timeout || ''
  form.deep_sleep_after.value = s?.deep_sleep_after || ''
  $('[data-sleep-error]').hidden = true
  $('[data-sleep-dialog]').showModal()
}

async function submitSleep(ev) {
  if (ev.submitter?.value !== 'save') return
  ev.preventDefault()
  const name = selected
  const data = Object.fromEntries(new FormData(ev.target))
  const btn = ev.submitter
  btn.disabled = true
  try {
    await api(`/sandboxes/${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify({ idle_timeout: data.idle_timeout, deep_sleep_after: data.deep_sleep_after }) })
    $('[data-sleep-dialog]').close()
    await loadList()
    if (selected === name) { renderedJSON = null; showPanel(name) }
  } catch (e) {
    const err = $('[data-sleep-error]'); err.textContent = e.message; err.hidden = false
  } finally { btn.disabled = false }
}

// Fills a select from GET /runtimes or /templates once, with the server's default selected
async function fillCatalog(sel, path) {
  if (sel.options.length) return
  try {
    const items = await api(path)
    sel.innerHTML = items.map(t => `<option value="${esc(t.name)}"${t.default ? ' selected' : ''}>${esc(t.name)} — ${esc(t.description)}</option>`).join('')
  } catch { sel.innerHTML = '<option value="">default</option>' }
}

// The compose text of the template last loaded into the editor: a create sends compose only when the text differs
let loadedCompose = { template: null, text: '' }

async function loadComposeEditor(name) {
  const box = $('[data-compose-editor]')
  try {
    const t = await api(`/templates/${encodeURIComponent(name)}`)
    // As the textarea will hold it: a textarea turns CRLF (a Windows checkout) into LF
    const text = t.compose.replace(/\r\n?/g, '\n')
    loadedCompose = { template: name, text }
    box.value = text
    box.placeholder = 'Paste your docker compose file here'
  } catch (e) {
    loadedCompose = { template: name, text: '' }
    box.value = ''
    box.placeholder = `Could not load the ${name} template: ${e.message}`
    return
  }
}

async function openNewDialog() {
  const dlg = $('[data-new-dialog]')
  await Promise.all([fillCatalog($('[data-runtimes]'), '/runtimes'), fillCatalog($('[data-templates]'), '/templates')])
  const tpl = $('[data-templates]').value
  // A failed create keeps the user's text; otherwise show the selected template's
  if (!$('[data-compose-editor]').value || loadedCompose.template !== tpl) await loadComposeEditor(tpl)
  $('[data-new-error]').hidden = true
  dlg.showModal()
}

async function submitNew(ev) {
  if (ev.submitter?.value !== 'create') return
  ev.preventDefault()
  const form = ev.target
  const data = Object.fromEntries(new FormData(form))
  const body = { name: data.name, create_inner_stack: form.create_inner_stack.checked }
  if (data.template) body.template = data.template
  if (data.runtime) body.runtime = data.runtime
  if (data.cpus) body.cpus = data.cpus
  if (data.memory) body.memory = data.memory
  const sshKeys = (data.ssh_keys || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (sshKeys.length) body.ssh_keys = sshKeys
  if (form.create_inner_stack.checked && data.compose !== undefined && data.compose !== loadedCompose.text) body.compose = data.compose
  if (data.idle_timeout) body.idle_timeout = data.idle_timeout
  if (data.deep_sleep_after) body.deep_sleep_after = data.deep_sleep_after
  const full = `${prefix}-${data.name}`
  // Reset now, not when the create finishes (that can take a minute): a dialog opened meanwhile
  // must not lose what is being typed. A failed create puts the submitted values back.
  const draft = { values: data, inner: form.create_inner_stack.checked, loaded: loadedCompose }
  form.reset()
  $('[data-compose-editor]').value = ''
  $('[data-compose-editor]').disabled = false
  pending.add(full)
  $('[data-new-dialog]').close()
  renderRows()
  showPanel(full)
  try {
    await api('/sandboxes', { method: 'POST', body: JSON.stringify(body) })
  } catch (e) {
    pending.delete(full)
    renderRows()
    selected = null
    $('[data-panel]').innerHTML = '<p class="muted">Select a sandbox to see its details.</p>'
    renderedName = null
    renderedJSON = null
    const dlg = $('[data-new-dialog]')
    const err = $('[data-new-error]')
    // Opened again meanwhile for another sandbox: say what failed, leave what is being typed alone
    if (dlg.open) { err.textContent = `${data.name}: ${e.message}`; err.hidden = false; return }
    for (const [k, v] of Object.entries(draft.values)) { const el = form.elements[k]; if (el && el.type !== 'checkbox') el.value = v }
    form.create_inner_stack.checked = draft.inner
    $('[data-compose-editor]').disabled = !draft.inner
    loadedCompose = draft.loaded
    err.textContent = e.message; err.hidden = false
    dlg.showModal()
    return
  }
  await loadList()
  showPanel(full)
}

function initSandboxes() {
  // Defaults and ceilings for the resource fields, in every view (loadQuota only runs in "mine")
  api('/me').then(m => { meInfo = m; showResourceHint() }).catch(() => {})
  $('[data-title]').textContent = view === 'all' ? 'All sandboxes' : 'My sandboxes'
  if (view === 'all') {
    $('[data-admin-only]').hidden = false
    $('[data-filter-text]').addEventListener('input', renderRows)
    // From the Overview: /admin?status=running, /admin?owner=…
    const q = new URLSearchParams(location.search)
    if (q.get('owner')) $('[data-filter-text]').value = q.get('owner')
    if (q.get('status')) $('[data-filter-status]').value = q.get('status')
    $('[data-filter-status]').addEventListener('change', renderRows)
  }
  $('[data-rows]').addEventListener('click', e => { const tr = e.target.closest('tr[data-name]'); if (tr) showPanel(tr.dataset.name) })
  $('[data-connect-login]')?.addEventListener('click', e => {
    const b = e.target.closest('button[data-show]'); if (!b) return
    const s = b.parentElement.querySelector('[data-secret]'); s.hidden = !s.hidden; b.textContent = s.hidden ? 'show' : 'hide'
  })
  $('[data-panel]').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return
    if (b.dataset.tab) return selectTab(b.dataset.tab)
    if (b.dataset.copyText !== undefined) return void copyText(b)
    if (b.dataset.deleteDigest) return void deleteVersion(b)
    if (b.dataset.show !== undefined) {
      const s = b.parentElement.querySelector('[data-secret]'); s.hidden = !s.hidden; b.textContent = s.hidden ? 'show' : 'hide'
      const mask = b.parentElement.querySelector('[data-secret-mask]'); if (mask) mask.hidden = !s.hidden
    }
    if (b.dataset.connect) { if ($('[data-connect-dialog]')) openConnectDialog(b.dataset.connect, { port: Number(b.dataset.port), user: b.dataset.user, demoPassword: b.dataset.demoPassword, keyFile: b.dataset.keyFile }); else location.reload(); return }
    if (b.dataset.act) act(b.dataset.act)
  })
  $('[data-panel]').addEventListener('keydown', e => {
    const t = e.target.closest('[role="tab"]'); if (!t) return
    const ids = P7yPanel.TABS.map(([id]) => id), i = ids.indexOf(t.dataset.tab)
    const next = { ArrowRight: ids[(i + 1) % ids.length], ArrowLeft: ids[(i - 1 + ids.length) % ids.length], Home: ids[0], End: ids[ids.length - 1] }[e.key]
    if (next) { e.preventDefault(); selectTab(next, true) }
  })
  $('[data-new]').addEventListener('click', openNewDialog)
  $('[data-new-form]').addEventListener('submit', submitNew)
  let previousTemplate = null
  $('[data-templates]').addEventListener('focus', e => { previousTemplate = e.target.value })
  $('[data-templates]').addEventListener('change', async e => {
    const box = $('[data-compose-editor]')
    const edited = box.value !== loadedCompose.text
    if (edited && !await confirmDialog(`Replace your changes with the ${e.target.value} template?`, 'Replace')) {
      e.target.value = previousTemplate ?? loadedCompose.template
      return
    }
    previousTemplate = e.target.value
    await loadComposeEditor(e.target.value)
  })
  $('[data-new-form] input[name=create_inner_stack]').addEventListener('change', e => { $('[data-compose-editor]').disabled = !e.target.checked })
  $('[data-sleep-form]').addEventListener('submit', submitSleep)
  $('[data-resource-form]').addEventListener('submit', submitResources)
  initTokenDialog()
  initExportDialog()
  initComposeDialog()
  $('[data-new-form] input[name=name]').addEventListener('input', e => {
    $('[data-name-hint]').textContent = `lowercase letters, digits, - and _ · URLs look like ${e.target.value || 'name'}-….${location.hostname.replace(/^(p7y|leander)\./, '')}`
  })
  initSwapDialog()
  loadList().then(() => { if (view === 'mine') wakeFromLink() })
  setInterval(async () => { await loadList(); if (selected && !pending.has(selected) && !busy.has(selected)) showPanel(selected) }, 5000)
}

// ---------- running limit: choose what sleeps ----------
function openSwapDialog(name, running, limit = running.length) {
  const dlg = $('[data-swap-dialog]')
  $('[data-swap-text]').textContent = `You can have ${limit} sandbox${limit === 1 ? '' : 'es'} running. Put one to sleep to wake ${shortName(name)}:`
  $('[data-swap-options]').innerHTML = running.map((r, i) => `<label class="check"><input type="radio" name="sleep" value="${esc(r)}"${i ? '' : ' checked'}> ${esc(shortName(r))}</label>`).join('')
  $('[data-swap-ok]').textContent = `Sleep it and wake ${shortName(name)}`
  $('[data-swap-error]').hidden = true
  dlg.dataset.sandbox = name
  dlg.showModal()
}
function initSwapDialog() {
  const form = $('[data-swap-form]')
  form.addEventListener('submit', async ev => {
    if (ev.submitter?.value !== 'swap') return
    ev.preventDefault()
    const dlg = $('[data-swap-dialog]'), name = dlg.dataset.sandbox, btn = ev.submitter
    btn.disabled = true
    try {
      await api(`/sandboxes/${encodeURIComponent(name)}/start`, { method: 'POST', body: JSON.stringify({ sleep: new FormData(form).get('sleep') }) })
      dlg.close()
      await loadList(); renderedJSON = null; await showPanel(name)
    } catch (e) { const err = $('[data-swap-error]'); err.textContent = e.message; err.hidden = false } finally { btn.disabled = false }
  })
}
// From the limit page of an asleep app: /?wake=<name>
async function wakeFromLink() {
  const name = new URLSearchParams(location.search).get('wake')
  if (!name) return
  history.replaceState(null, '', location.pathname)
  try { await api(`/sandboxes/${encodeURIComponent(name)}/start`, { method: 'POST' }); await loadList(); await showPanel(name) }
  catch (e) { if (e.body?.reason === 'running') openSwapDialog(name, e.body.running, e.body.limit); else alert(e.message) }
}

// ---------- tokens ----------
// Sandboxes the signed-in user owns (a token can only be limited to one of those)
async function ownSandboxes() {
  try { return (await api('/sandboxes')).filter(s => (s.owner || 'admin') === me) } catch { return [] }
}

async function openTokenDialog(sandbox) {
  const select = $('[data-token-sandbox]')
  const own = await ownSandboxes()
  select.innerHTML = `<option value="">All my sandboxes</option>` +
    own.map(s => `<option value="${esc(s.name)}">${esc(shortName(s.name))}</option>`).join('')
  select.value = sandbox && own.some(s => s.name === sandbox) ? sandbox : ''
  $('[data-token-error]').hidden = true
  $('[data-token-dialog]').showModal()
}

function initTokenDialog(onCreated) {
  // A page from an older server (or an old cached page) has no token dialog: do not take the rest of the page down with it
  if (!$('[data-token-form]')) return
  $('[data-token-form]').addEventListener('submit', async ev => {
    if (ev.submitter?.value !== 'create') return
    ev.preventDefault()
    const data = Object.fromEntries(new FormData(ev.target))
    if (!data.sandbox) delete data.sandbox
    try {
      const created = await api('/tokens', { method: 'POST', body: JSON.stringify(data) })
      $('[data-token-dialog]').close()
      ev.target.reset()
      $('[data-created-token]').textContent = created.token
      $('[data-created-scope]').textContent = created.sandbox ? ` Works only for sandbox ${shortName(created.sandbox)}.` : ''
      $('[data-download-env]').dataset.sandbox = created.sandbox || ''
      $('[data-copy]').textContent = 'Copy'
      $('[data-token-created]').showModal()
      onCreated?.()
    } catch (e) { const err = $('[data-token-error]'); err.textContent = e.message; err.hidden = false }
  })
  $('[data-copy]').addEventListener('click', async e => {
    await navigator.clipboard.writeText($('[data-created-token]').textContent)
    e.target.textContent = 'Copied'
  })
  // Made here, from the token on screen (the only moment it exists in clear): the server keeps no copy
  $('[data-download-env]').addEventListener('click', e => {
    const sandbox = e.target.dataset.sandbox
    const text = agentEnv({ url: location.origin, token: $('[data-created-token]').textContent, sandbox })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }))
    a.download = 'p7y.env' // a leading-dot name is renamed by browsers (Chrome saves .env as env.txt)
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  })
}

function agentEnv({ url, token, sandbox }) {
  return [
    '# Purgatory sandbox access for a coding agent. A secret: keep this file out of git.',
    `P7Y_URL=${url}`,
    `P7Y_TOKEN=${token}`,
    ...(sandbox ? [`P7Y_SANDBOX=${sandbox}`] : []),
    'P7Y_AGENT_GUIDE=https://csakaszamok.github.io/p7y/latest/agent-guide/index.md',
    '',
  ].join('\n')
}

async function loadTokens() {
  const cols = ['Name', 'Token', ...(isAdmin ? ['Owner'] : []), 'Access', 'Created', 'Expires', 'Last used', '']
  $('[data-token-head]').innerHTML = `<tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>`
  let list, existing
  // Without the sandbox list (e.g. Docker is down) tokens are still listed and revocable; only "(deleted)" is left out
  try { [list, existing] = await Promise.all([api('/tokens'), api('/sandboxes').catch(() => null)]) } catch (e) { $('[data-token-rows]').innerHTML = `<tr><td class="error">${esc(e.message)}</td></tr>`; return }
  const names = existing && new Set(existing.map(s => s.name))
  const access = t => !t.sandbox ? 'all sandboxes'
    : `${esc(shortName(t.sandbox))}${!names || names.has(t.sandbox) ? '' : ' <span class="muted">(deleted)</span>'}`
  const d = iso => iso ? new Date(iso).toLocaleDateString() : '—'
  $('[data-token-rows]').innerHTML = list.length ? list.map(t => `
    <tr>
      <td>${esc(t.name)}</td>
      <td>${t.hint ? `<code>${esc(t.hint)}</code>` : '<span class="muted">—</span>'}</td>
      ${isAdmin ? `<td>${esc(t.owner)}</td>` : ''}
      <td>${access(t)}</td>
      <td>${d(t.created_at)}</td><td>${t.expires_at ? d(t.expires_at) : 'never'}</td><td>${d(t.last_used_at)}</td>
      <td><button class="danger" data-revoke="${esc(t.id)}">Revoke</button></td>
    </tr>`).join('') : `<tr><td class="muted" colspan="${cols.length}">No tokens yet.</td></tr>`
}

function initTokens() {
  $('[data-new-token]').addEventListener('click', () => openTokenDialog())
  initTokenDialog(loadTokens)
  $('[data-token-rows]').addEventListener('click', async e => {
    const id = e.target.closest('button')?.dataset.revoke
    if (!id || !await confirmDialog('Revoke this token? Agents using it stop working.', 'Revoke')) return
    try { await api(`/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }); loadTokens() } catch (err) { alert(err.message) }
  })
  loadTokens()
}

if (view === 'mine' || view === 'all') initSandboxes()
if (view === 'overview') initOverview()
if (view === 'tokens') initTokens()
if (view === 'ssh-keys') initSshKeys()
