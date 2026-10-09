// The sandbox details panel as HTML, built by pure functions (no DOM): P7yPanel in the browser,
// module.exports in Node for the tests. ui/app.js renders it and handles the clicks.
;(function (root) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const TABS = [['apps', 'Apps'], ['access', 'Access'], ['resources', 'Resources'], ['registry', 'Registry'], ['settings', 'Settings']]

  const statusLabel = s => ({ exited: 'asleep', created: 'asleep', deep_sleep: 'deep sleep', starting: 'creating…' }[s] || s)
  // A stopped sandbox whose last start failed is not asleep; "created" (recreated, never started) is asleep
  const statusClass = s => s.start_error ? 'failed' : s.status === 'created' ? 'exited' : s.status

  function remaining(iso, now = Date.now()) {
    const ms = Date.parse(iso) - now
    if (isNaN(ms)) return ''
    if (ms <= 0) return 'any moment now'
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60)
    if (d > 0) return `${d} d ${h} h`
    if (h > 0) return `${h} h ${m} min`
    return `${m}:${String(s % 60).padStart(2, '0')}`
  }
  const countdown = (iso, now) => `<span data-until="${esc(iso)}">${esc(remaining(iso, now))}</span>`

  const GB = 1024 ** 3
  const fmtBytes = b => b >= GB ? `${(b / GB).toFixed(1).replace(/\.0$/, '')} GB` : `${Math.round(b / 1024 ** 2)} MB`
  function meter(used, max) {
    const pct = max ? Math.min(100, Math.round(used / max * 100)) : 0
    return `<span class="meter ${pct >= 95 ? 'hot' : pct >= 80 ? 'warm' : ''}"><span style="width:${pct}%"></span></span>`
  }

  // Portainer's address only while it is one of the links: published on 127.0.0.1 it is private to the sandbox
  function portainerShown(s, extras) {
    if (!extras.portainer_url) return false
    try { return (s.tunnel_urls || []).map(u => u.toLowerCase()).includes(new URL(extras.portainer_url).host.toLowerCase()) } catch { return false }
  }

  // Docker says "2026-10-04 13:02:34.871 +0000 UTC", which Date.parse does not read
  function parseCreated(str) {
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?) ([+-]\d{2})(\d{2})/.exec(String(str ?? ''))
    const t = m ? Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4]}`) : Date.parse(str)
    return isNaN(t) ? null : new Date(t)
  }
  function relativeAge(date, now = Date.now()) {
    const min = Math.max(0, Math.floor((now - date.getTime()) / 60000))
    if (min < 1) return 'just now'
    if (min < 60) return `${min} min ago`
    if (min < 1440) return `${Math.floor(min / 60)} h ago`
    return `${Math.floor(min / 1440)} d ago`
  }

  const firstLabel = host => String(host).toLowerCase().split('.')[0].split(':')[0]

  /** One row per app link, with the TLS TCP address of the same port; TCP addresses without a link get their own row. */
  function appRows(s) {
    const apps = new Map((s.apps || []).map(a => [a.url, a]))
    const tcp = [...(s.tcp_addresses || (s.tcp_urls || []).map(address => ({ address })))]
    const rows = (s.tunnel_urls || []).map(url => {
      const a = apps.get(url) || {}
      const i = tcp.findIndex(t => firstLabel(t.address) === `${firstLabel(url)}-tcp`)
      const own = i >= 0 ? tcp.splice(i, 1)[0] : null
      return { service: a.service || firstLabel(url), url, answers: a.answers ?? null, tcp: own }
    })
    for (const t of tcp) rows.push({ service: firstLabel(t.address).replace(/-tcp$/, ''), url: null, answers: null, tcp: t })
    return rows
  }

  const copyButton = text => `<button class="link copy-btn" data-copy-text="${esc(text)}" title="Copy">copy</button>`
  const secret = value => `<span class="muted" data-secret-mask>••••••••</span><code data-secret hidden>${esc(value)}</code> <button class="link" data-show>show</button> ${copyButton(value)}`
  const table = (head, rows, cls = '') => `<table class="panel-table ${cls}">${head ? `<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>` : ''}<tbody>${rows.join('')}</tbody></table>`
  const kv = (k, v) => `<tr><td class="k">${k}</td><td>${v}</td></tr>`

  function header(s, ctx) {
    const st = s.status
    const buttons = st === 'running' ? '<button class="primary" data-act="terminal">Terminal</button><button data-act="logs">Logs</button><button data-act="stop">Sleep</button>'
      : st === 'deep_sleep' ? '<button class="primary" data-act="start">Wake</button>'
      : st === 'starting' ? ''
      : '<button class="primary" data-act="start">Wake</button><button data-act="logs">Logs</button>'
    const reset = '<button class="link" data-act="keep-awake" title="Start the countdown over, as a visit would">Reset</button>'
    const line = st === 'running'
      ? (s.idle_timeout === 'off' ? 'Never sleeps' : `${s.stops_at ? `Sleeps in ${countdown(s.stops_at, ctx.now)}` : 'The idle countdown has not started yet'} · ${reset}`)
      : st === 'deep_sleep' ? 'In deep sleep · opening an app or Wake rebuilds it'
      : st === 'exited' || st === 'created'
        ? [s.deep_sleep_after !== 'off' && s.deep_sleep_at ? `Deep sleep in ${countdown(s.deep_sleep_at, ctx.now)}` : '', s.start_error ? '' : 'opening an app wakes it'].filter(Boolean).join(' · ')
        : ''
    return `<div class="panel-head"><h2>${esc(ctx.shortName(s.name))}</h2><span class="status ${esc(statusClass(s))}">${esc(s.start_error ? 'failed to start' : statusLabel(st))}</span>
      <div class="actions head-actions">${buttons}</div></div>
      ${line ? `<p class="panel-sub">${line}</p>` : ''}
      ${s.start_error ? `<p class="error panel-error">${esc(s.start_error)}</p>` : ''}`
  }

  function appsTab(s, ctx) {
    const extras = s.extras || {}
    const rows = appRows(s)
    if (!rows.length) return '<p class="muted">No apps yet — publish a port on all interfaces (e.g. 8080:8080) to get a link.</p>'
    const mark = a => a === true ? ' <span class="ok" title="answering">✓</span><span class="sr-only">answering</span>'
      : a === false ? ' <span class="warn" title="not answering">⚠</span><span class="sr-only">not answering</span>' : ''
    const body = rows.map(r => `<tr>
      <td>${esc(r.service)}</td>
      <td>${r.url ? `<a href="${esc(ctx.protocol)}//${esc(r.url)}" target="_blank" rel="noopener" title="${esc(r.url)}">open ↗</a>${mark(r.answers)}` : '<span class="muted">—</span>'}</td>
      <td>${r.tcp ? `<span class="tcp">${esc(r.tcp.address)}</span> ${copyButton(r.tcp.address)}` : ''}</td>
      <td>${r.tcp ? `<button class="link" data-connect="${esc(r.tcp.address)}" data-port="${esc(r.tcp.port ?? '')}" data-user="${esc(r.tcp.user ?? '')}"${extras.demo_password ? ` data-demo-password="${esc(extras.demo_password)}"` : ''}>Connect…</button>` : ''}</td>
    </tr>`)
    const down = rows.filter(r => r.answers === false).map(r => r.service)
    const tip = !down.length ? ''
      : down.length === 1 ? `<p class="not-answering">⚠ ${esc(down[0])} is not answering — does it listen on 0.0.0.0 (not 127.0.0.1) inside its container?</p>`
      : `<p class="not-answering">⚠ ${down.map(esc).join(', ')} are not answering — do they listen on 0.0.0.0 (not 127.0.0.1) inside their containers?</p>`
    const asleep = s.status !== 'running' && rows.some(r => r.url) ? '<p class="muted">opening one wakes the sandbox</p>' : ''
    return table(['App', 'Web', 'TCP', ''], body, 'apps-table') + tip + asleep
  }

  function accessTab(s, ctx) {
    const extras = s.extras || {}
    const parts = []
    if (s.ssh) {
      const key = s.ssh.generated_key
        ? `<a class="link" href="/sandboxes/${encodeURIComponent(s.name)}/ssh-key" download>Download key</a>`
        : '<button class="link" data-act="ssh-key">Create key</button>'
      const own = s.ssh.keys || s.ssh.generated_key ? '' : ' <span class="muted">or <a href="/settings/ssh-keys">add your own</a></span>'
      parts.push(table(['SSH', ''], [
        kv('Address', `<span class="tcp">${esc(s.ssh.address)}</span> ${copyButton(s.ssh.address)}`),
        kv('Login', `root · <button class="link" data-connect="${esc(s.ssh.address)}" data-port="22" data-user="root"${s.ssh.generated_key ? ` data-key-file="${esc(ctx.shortName(s.name))}.key"` : ''}>Connect…</button> · ${key}${own}`),
      ]))
    }
    // The password stays reachable when Portainer is private (published on 127.0.0.1): only its link goes
    const portainerLink = portainerShown(s, extras)
    if (portainerLink || extras.portainer_password) {
      parts.push(table(['Portainer', ''], [
        ...(portainerLink ? [kv('Address', `<a href="${esc(extras.portainer_url)}" target="_blank" rel="noopener">${esc(new URL(extras.portainer_url).host)} ↗</a>`)] : []),
        ...(extras.portainer_password ? [kv('Password', secret(extras.portainer_password))] : []),
      ]))
    }
    if (extras.demo_password) parts.push(table(['Demo', ''], [kv('Password', secret(extras.demo_password))]))
    // Docker from outside (TLS passed through to the sandbox's dockerd) and the export for coding agents
    const da = s.docker_access
    if (da) {
      const owner = (s.owner || 'admin') === ctx.me
      const state = da.state === 'ready'
        ? `ready${owner ? ' · <button class="link" data-act="rotate-docker-keys">Rotate Docker keys…</button>' : ''}`
        : `needs new certificates${owner || ctx.isAdmin ? ' · <button class="link" data-act="enable-docker">Enable</button> <span class="muted">(restarts the sandbox, ~30 s)</span>' : ''}`
      parts.push(table(['Docker & registry', ''], [
        kv('Address', `<span class="tcp">${esc(da.host)}:443</span> ${copyButton(`${da.host}:443`)}`),
        kv('State', state),
      ]))
    }
    if ((s.owner || 'admin') === ctx.me) parts.push(table(['API', ''], [kv('Token', '<button data-act="token">Token for this sandbox…</button>')]))
    // What a coding agent needs, for the owner (the new token is theirs), whatever the Docker access state
    if ((s.owner || 'admin') === ctx.me) parts.unshift('<div class="actions agent-actions"><button class="primary" data-act="export">Export for coding agents…</button><button data-act="copy-env">Copy as .env</button></div>')
    return parts.length ? parts.join('') : '<p class="muted">Nothing to connect to here.</p>'
  }

  function resourcesTable(s) {
    if (!s.limits) return s.disk ? table(['', 'Now', 'Limit'], [diskRow(s.disk)]) : '<p class="muted">no limit</p>'
    const live = s.status === 'running' && s.usage
    return table(['', 'Now', 'Limit'], [
      `<tr><td>CPU</td><td>${live ? `${meter(s.usage.cpu, s.limits.cpus)}${s.usage.cpu.toFixed(2)}` : '<span class="muted">—</span>'}</td><td>${s.limits.cpus} CPUs</td></tr>`,
      `<tr><td>Memory</td><td>${live ? `${meter(s.usage.memory, s.limits.memory)}${fmtBytes(s.usage.memory)}` : '<span class="muted">—</span>'}</td><td>${fmtBytes(s.limits.memory)}</td></tr>`,
      ...(s.disk ? [diskRow(s.disk)] : []),
    ]) + (s.disk?.over ? '<p class="warn">⚠ Over its disk limit: clean up unused images and volumes in the sandbox (<code>docker system prune</code>). Nothing is stopped.</p>' : '')
  }

  // Measured from outside every 15 minutes while running (once after it stops): a warning, never a stop
  function diskRow(d) {
    const now = d.used === null ? '<span class="muted">not measured yet</span>'
      : `${meter(d.used, d.limit)}${d.over ? '⚠ ' : ''}${fmtBytes(d.used)}`
    const when = d.measured_at ? ` title="measured ${esc(new Date(d.measured_at).toLocaleString())}"` : ''
    return `<tr><td>Disk</td><td${when}>${now}</td><td>${fmtBytes(d.limit)}</td></tr>`
  }

  function settingsTab(s, ctx) {
    const created = parseCreated(s.created_at)
    const when = created ? `${esc(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(created))} <span class="muted">(${relativeAge(created, ctx.now)})</span>` : esc(s.created_at || '—')
    const sleep = `${s.idle_timeout === 'off' ? 'never sleeps' : `after ${esc(s.idle_timeout || '—')} idle`} · ${s.deep_sleep_after === 'off' ? 'no deep sleep' : `deep sleep ${esc(s.deep_sleep_after || '—')} after`} <button class="link" data-act="sleep">Change…</button>`
    return table(null, [
      ...(ctx.isAdmin ? [kv('Owner', esc(s.owner === 'admin' ? 'admin API' : s.owner))] : []),
      kv('Runtime · Template', `${esc([s.runtime, s.template].filter(Boolean).join(' · ') || '—')}${s.compose === 'edited' ? ' <span class="muted">(edited)</span>' : ''}`),
      kv('Created', when),
      kv('Sleep', sleep),
      kv('Compose', '<button class="link" data-act="compose">Starter stack…</button>'),
    ]) + `<div class="danger-zone"><h3>Danger zone</h3><div class="actions">${s.status !== 'deep_sleep' ? '<button data-act="deep-sleep">Deep sleep now</button>' : ''}<button class="danger" data-act="delete">Archive…</button></div></div>`
  }

  /** The Registry tab: the sandbox's images, their scan results, and whether they can be pulled without a login. */
  function registryTable(d) {
    if (!d.repos.length) return `<p class="muted">No images yet — push one: <code>docker push ${esc(d.registry)}/&lt;sandbox&gt;/&lt;app&gt;:1</code></p>`
    const state = v => v.state === 'clean' ? '<span class="ok">clean</span>'
      : v.state === 'flagged' ? '<span class="warn">flagged</span>'
      : v.state === 'error' ? `<span class="warn" title="${esc(v.error || '')}">scan failed</span>`
      : '<span class="muted">scanning…</span>'
    return d.repos.map(r => {
      const app = r.repo.split('/').slice(1).join('/')
      const clean = r.versions.length > 0 && r.versions.every(v => v.state === 'clean')
      const access = !d.public_pull ? 'private (public pull is off)' : clean ? 'public — anyone can pull' : 'private — not pullable without a token'
      const rows = r.versions.map(v => `<tr>
        <td class="tcp">${esc(d.registry)}/${esc(r.repo)}:${esc(v.tags[0] || v.digest.slice(7, 19))}</td>
        <td>${state(v)}${v.findings.length ? `<ul class="findings">${v.findings.map(f => `<li>${esc(f.file)} — ${esc(f.rule)}${f.sample ? ` <code>${esc(f.sample)}</code>` : ''}</li>`).join('')}</ul>` : ''}</td>
        <td><button class="link danger-link" data-delete-app="${esc(app)}" data-delete-digest="${esc(v.digest)}">Delete</button></td>
      </tr>`)
      return `<h3 class="repo">${esc(r.repo)} <span class="muted">· ${access}</span></h3>` + table(['Image', 'Scan', ''], rows)
    }).join('')
  }

  function renderPanel(s, ctx) {
    const tab = TABS.some(([id]) => id === ctx.tab) ? ctx.tab : 'apps'
    const tabs = TABS.map(([id, label]) => `<button role="tab" id="tab-${id}" aria-selected="${id === tab}" aria-controls="tabpanel-${id}" tabindex="${id === tab ? 0 : -1}" data-tab="${id}">${label}</button>`).join('')
    const body = {
      apps: appsTab(s, ctx),
      access: accessTab(s, ctx),
      resources: `<div data-resources>${resourcesTable(s)}</div><div class="actions"><button data-act="resources">Change limits…</button></div>`,
      registry: '<div data-registry><p class="muted">Loading…</p></div>',
      settings: settingsTab(s, ctx),
    }
    return `${header(s, ctx)}
      <div class="tabs" role="tablist" aria-label="Sandbox details">${tabs}</div>
      ${TABS.map(([id]) => `<div role="tabpanel" id="tabpanel-${id}" aria-labelledby="tab-${id}" data-tabpanel="${id}"${id === tab ? '' : ' hidden'}>${body[id]}</div><!--/${id}-->`).join('')}
      <p class="error" data-act-error hidden></p>`
  }

  // ---------- overview (GET /sandboxes/summary + the list) ----------
  /** The counts of these sandboxes, with quota and archived from the server's summary (the list itself is fresher). */
  function countsOf(list, quota, archived) {
    const running = list.filter(s => s.status === 'running').length
    const deep_sleep = list.filter(s => s.status === 'deep_sleep').length
    return { quota, total: list.length, free: quota === null ? null : Math.max(0, quota - running), running, asleep: list.length - running - deep_sleep, deep_sleep, archived }
  }

  function ring(used, max) {
    const C = 2 * Math.PI * 12, f = max ? Math.min(1, used / max) : 0
    return `<svg class="ov-ring" viewBox="0 0 30 30" aria-hidden="true"><circle class="track" cx="15" cy="15" r="12"/>${f > 0 ? `<circle class="fill${f >= 1 ? ' full' : ''}" cx="15" cy="15" r="12" stroke-dasharray="${(f * C).toFixed(1)} ${C.toFixed(1)}"/>` : ''}</svg>`
  }
  const card = (cls, label, icon, num, sub, href) =>
    `<${href ? `a href="${esc(href)}"` : 'div'} class="ov-card ${cls}"><div class="ov-top"><span>${label}</span>${icon}</div><div class="ov-num">${num}</div><div class="ov-sub">${sub}</div><span class="ov-glow"></span></${href ? 'a' : 'div'}>`
  const dot = cls => `<span class="ov-dot ${cls}"></span>`

  /**
   * The Overview page. sum: GET /sandboxes/summary; list: GET /sandboxes (the caller's, or for the admin everyone's).
   * ctx.isAdmin: the server view (users' sandboxes against SANDBOX_MAX_TOTAL, host resources, disk, owners).
   */
  function overviewHtml(sum, list, ctx) {
    const name = n => esc(ctx.shortName ? ctx.shortName(n) : n)
    const c = countsOf(list, sum.quota ?? null, sum.archived ?? 0)
    const listHref = q => ctx.isAdmin ? `/admin${q ? `?${q}` : ''}` : '/'
    let first
    if (ctx.isAdmin) {
      // Only awake sandboxes hold a slot: one in deep sleep is not counted
      const awake = list.filter(s => s.status !== 'deep_sleep')
      const users = awake.filter(s => (s.owner || 'admin') !== 'admin').length, adm = awake.length - users
      const lim = sum.server_limit
      first = lim
        ? card('allowed', "Users' slots used", ring(users, lim), `${users}<small> / ${lim}</small>`, `server limit · ${Math.max(0, lim - users)} free · + ${adm} of the admin, not counted`, listHref(''))
        : card('allowed', "Users' slots used", ring(0, 1), `${users}`, `no server limit · + ${adm} of the admin`, listHref(''))
    } else if (sum.server_full) {
      first = card('allowed warn', 'Server', '⚠', 'full', 'the server is full: ask the administrator', '/')
    }
    // A user's quota counts running sandboxes only: asleep and deep-sleeping ones are free
    const q = ctx.isAdmin ? null : c.quota
    const runningSub = q === null ? (c.running ? 'awake, serving' : 'nothing awake')
      : c.running >= q ? 'limit reached: Wake lets you choose one to put to sleep' : `${q - c.running} more can run`
    const over = list.filter(s => s.disk && s.disk.over)
    const cards = [
      ...(first ? [first] : []),
      card('running', 'Running', dot('running'),
        q === null ? c.running : `${c.running}<small> / ${q}</small>`,
        runningSub,
        listHref(ctx.isAdmin ? 'status=running' : '')),
      card('asleep', 'Asleep', dot('asleep'), c.asleep, ctx.isAdmin ? 'wake on the next request' : 'wake on the next request · not counted', listHref(ctx.isAdmin ? 'status=exited' : '')),
      card('deep', 'Deep sleep', dot('deep'), c.deep_sleep, 'containers freed, data kept · not counted', listHref(ctx.isAdmin ? 'status=deep_sleep' : '')),
      card('archived', 'Archived', dot('archived'), c.archived, 'deleted, kept, not counted'),
      ...(over.length ? [card('warn', 'Disk', '⚠', over.length, `${over.length} over its disk limit`, listHref(''))] : []),
    ]
    const pct = n => c.total ? (n / c.total * 100).toFixed(1) : 0
    const stack = `<div class="ov-stack"><span class="r" style="width:${pct(c.running)}%"></span><span class="a" style="width:${pct(c.asleep)}%"></span><span class="d" style="width:${pct(c.deep_sleep)}%"></span></div>
      <div class="ov-legend"><span>${dot('running small')}${c.running} running</span><span>${dot('asleep small')}${c.asleep} asleep</span><span>${dot('deep small')}${c.deep_sleep} deep sleep</span></div>`
    let out = `<div class="ov-cards">${cards.join('')}</div>${stack}`

    if (ctx.isAdmin) {
      const r = sum.resources
      const row = (label, use, res, max, unit, suffix = '') => `<div class="ov-meterrow"><span>${label}</span><div class="ov-meter"><span class="res" style="width:${Math.min(100, res / max * 100).toFixed(1)}%"></span><span class="use" style="width:${Math.max(1, Math.min(100, use / max * 100)).toFixed(1)}%"></span></div><span class="ov-val">${unit(use)} of ${unit(max)}${suffix} <span class="muted">· ${unit(res)}${suffix} reserved</span></span></div>`
      const res = r
        ? row('CPU', r.cpu.used, r.cpu.reserved, r.cpu.host, v => `${Number(v.toFixed(2))}`, ' cores') + row('Memory', r.memory.used, r.memory.reserved, r.memory.host, fmtBytes)
        : '<p class="muted">not available</p>'
      const top = list.filter(s => s.disk && s.disk.used !== null).sort((a, b) => b.disk.used - a.disk.used).slice(0, 4)
      const disk = r ? `<div class="ov-big">${fmtBytes(r.disk.used)}</div><div class="muted">used by ${list.length} sandbox${list.length === 1 ? '' : 'es'}${r.disk.over ? ` · <span class="warn">⚠ ${r.disk.over} over its limit</span>` : ''}</div>` : ''
      const topList = `<ul class="ov-top3">${top.map(s => `<li class="${s.disk.over ? 'over' : ''}"><span>${s.disk.over ? '⚠ ' : ''}${name(s.name)}</span><span class="bar"><span style="width:${Math.min(100, s.disk.used / s.disk.limit * 100).toFixed(1)}%"></span></span><span class="v">${fmtBytes(s.disk.used)}</span></li>`).join('')}</ul>`
      out += `<div class="ov-grid2"><section class="ov-box"><h2>Host resources</h2>${res}<p class="ov-note">Solid: what running sandboxes use now. Striped: what their limits reserve. Asleep sandboxes use nothing.</p></section>
        <section class="ov-box"><h2>Disk</h2>${disk}${topList}</section></div>`
      const owners = (sum.by_owner || []).map(o => ({ ...o, ...countsOf(list.filter(s => (s.owner || 'admin') === o.owner), o.quota, o.archived) }))
      const ownerRows = owners.map(o => {
        const qb = o.quota === null ? '' : `<span class="ov-qbar${o.running >= o.quota ? ' full' : ''}"><span style="width:${Math.min(100, o.running / o.quota * 100).toFixed(1)}%"></span></span>`
        return `<tr><td><a href="/admin?owner=${encodeURIComponent(o.owner)}">${esc(o.owner === 'admin' ? 'admin API' : o.owner)}</a></td><td>${o.total}</td><td>${qb}${dot('running small')}${o.running} / ${o.quota === null ? '∞' : o.quota}</td><td>${dot('asleep small')}${o.asleep}</td><td class="ov-hide">${dot('deep small')}${o.deep_sleep}</td><td class="ov-hide">${o.archived}</td></tr>`
      }).join('')
      out += `<section class="ov-box"><h2>Per owner</h2><div class="ov-tablewrap"><table class="ov-table"><thead><tr><th>Owner</th><th>Sandboxes</th><th>Running</th><th>Asleep</th><th class="ov-hide">Deep sleep</th><th class="ov-hide">Archived</th></tr></thead><tbody>${ownerRows}</tbody></table></div><p class="ov-note">An owner opens All sandboxes, filtered to them.</p></section>`
    } else if (list.length) {
      const label = { running: 'running', exited: 'asleep', deep_sleep: 'deep sleep' }
      const cls = { running: 'running', deep_sleep: 'deep' }
      out += `<section class="ov-box"><h2>Your sandboxes</h2><div class="ov-tablewrap"><table class="ov-table"><thead><tr><th>Name</th><th>Status</th><th>Disk</th></tr></thead><tbody>${list.map(s => `<tr><td><strong>${name(s.name)}</strong></td><td>${dot(`${cls[s.status] || 'asleep'} small`)}${label[s.status] || esc(s.status)}</td><td>${s.disk && s.disk.used !== null ? `${s.disk.over ? '⚠ ' : ''}${fmtBytes(s.disk.used)} <span class="muted">/ ${fmtBytes(s.disk.limit)}</span>` : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div></section>`
    }
    return out
  }

  const api = { overviewHtml, countsOf, esc, TABS, statusLabel, statusClass, remaining, countdown, fmtBytes, meter, portainerShown, parseCreated, relativeAge, appRows, resourcesTable, registryTable, renderPanel }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.P7yPanel = api
})(typeof window !== 'undefined' ? window : globalThis)
