// The sandbox details panel as HTML, built by pure functions (no DOM): P7yPanel in the browser,
// module.exports in Node for the tests. ui/app.js renders it and handles the clicks.
;(function (root) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const TABS = [['apps', 'Apps'], ['access', 'Access'], ['files', 'Files'], ['resources', 'Resources'], ['registry', 'Registry'], ['settings', 'Details']]

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
  /**
   * The sandbox list's free-text filter: every word must appear somewhere in the sandbox's name, owner,
   * status, template, runtime or its apps (service or address); case does not matter.
   */
  function matchesFilter(s, text) {
    const words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return true
    const hay = [s.name, s.owner, s.status, statusLabel(s.status), s.start_error ? 'failed' : '', s.template, s.runtime,
      ...(s.apps || []).flatMap(a => [a.service, a.url])].filter(Boolean).join(' ').toLowerCase()
    return words.every(w => hay.includes(w))
  }
  const countdown = (iso, now) => `<span data-until="${esc(iso)}">${esc(remaining(iso, now))}</span>`

  const GB = 1024 ** 3
  const fmtBytes = b => b >= GB ? `${(b / GB).toFixed(1).replace(/\.0$/, '')} GB` : `${Math.round(b / 1024 ** 2)} MB`
  function meter(used, max) {
    const pct = max ? Math.min(100, Math.round(used / max * 100)) : 0
    return `<span class="meter ${pct >= 95 ? 'hot' : pct >= 80 ? 'warm' : ''}"><span style="width:${pct}%"></span></span>`
  }

  // My sandboxes' running line (GET /me): the guarantee, and how far above it while the server has room
  function quotaLine(me) {
    const max = me.max_running === undefined ? me.quota : me.max_running
    if (max === me.quota) return { text: `Running ${me.sandbox_count} / ${me.quota}`, title: '' }
    const more = max === null ? 'more' : `up to ${max}`
    return { text: `Running ${me.sandbox_count} / ${me.quota} · ${more}`, title: `${me.quota} running sandbox${me.quota === 1 ? '' : 'es'} guaranteed; ${more} while the server has room` }
  }

  // The server's places in the topbar (GET /me server_places): like the sign-in page, orange from 90%, red when full
  function placesBadge(sp) {
    if (!sp) return null
    const free = Math.max(0, sp.limit - sp.used)
    const state = free === 0 ? 'full' : sp.used / sp.limit >= 0.9 ? 'warn' : ''
    return { text: `${sp.used} / ${sp.limit} places`, state,
      title: `Sandbox places on the server: ${sp.used} taken, ${free} free (running and asleep sandboxes; deep sleep holds none)` }
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
      return { service: a.service || firstLabel(url), project: a.project, url, answers: a.answers ?? null, ...(a.access ? { access: a.access } : {}), tcp: own }
    })
    // A service name in more than one compose project (web in each): the project in front tells them apart
    const projectsOf = new Map()
    for (const r of rows) if (r.project) projectsOf.set(r.service, new Set([...(projectsOf.get(r.service) || []), r.project]))
    for (const r of rows) {
      if (r.project && projectsOf.get(r.service).size > 1) r.service = `${r.project} / ${r.service}`
      delete r.project
    }
    for (const t of tcp) rows.push({ service: firstLabel(t.address).replace(/-tcp$/, ''), url: null, answers: null, tcp: t })
    return rows
  }

  const copyButton = text => `<button class="link copy-btn" data-copy-text="${esc(text)}" title="Copy">copy</button>`
  const secret = value => `<span class="muted" data-secret-mask>••••••••</span><code data-secret hidden>${esc(value)}</code> <button class="link" data-show>show</button> ${copyButton(value)}`
  const table = (head, rows, cls = '') => `<table class="panel-table ${cls}">${head ? `<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>` : ''}<tbody>${rows.join('')}</tbody></table>`
  const kv = (k, v) => `<tr><td class="k">${k}</td><td>${v}</td></tr>`

  // "3 weeks ago" from an ISO time, by the page's clock
  function ago(iso, now) {
    const sec = Math.max(0, ((now ?? Date.now()) - Date.parse(iso)) / 1000)
    const n = (v, unit) => `${v} ${unit}${v === 1 ? '' : 's'} ago`
    if (sec < 60) return 'just now'
    if (sec < 3600) return `${Math.round(sec / 60)} min ago`
    if (sec < 86400) return `${Math.round(sec / 3600)} h ago`
    const d = sec / 86400
    if (d < 14) return n(Math.round(d), 'day')
    if (d < 60) return n(Math.round(d / 7), 'week')
    if (d < 365) return n(Math.round(d / 30), 'month')
    return n(Math.round(d / 365), 'year')
  }

  function header(s, ctx) {
    const st = s.status
    // Simple: only Sleep or Wake (no Terminal, no Logs)
    const buttons = ctx.simple ? (st === 'running' ? '<button data-act="stop">Sleep</button>' : st === 'starting' ? '' : '<button class="primary" data-act="start">Wake</button>')
      : st === 'running' ? '<button class="primary" data-act="terminal">Terminal</button><button data-act="logs">Logs</button><button data-act="stop">Sleep</button>'
      : st === 'deep_sleep' ? '<button class="primary" data-act="start">Wake</button>'
      : st === 'starting' ? ''
      : '<button class="primary" data-act="start">Wake</button><button data-act="logs">Logs</button>'
    const reset = '<button class="link" data-act="keep-awake" title="Start the countdown over, as a visit would">Reset</button>'
    const line = st === 'running'
      ? (s.idle_timeout === 'off' ? 'Never sleeps' : `${s.stops_at ? `Sleeps in ${countdown(s.stops_at, ctx.now)}` : s.going_to_sleep ? 'Going to sleep…' : 'The idle countdown has not started yet'} · ${reset}`)
      : st === 'deep_sleep' ? 'In deep sleep · opening an app or Wake rebuilds it'
      // Asleep: only what matters now; when it last ran and when deep sleep comes are on the Details tab
      : st === 'exited' || st === 'created'
        ? (s.start_error ? '' : 'Asleep · opening an app wakes it')
        : ''
    return `<div class="panel-head"><h2>${esc(ctx.shortName(s.name))}</h2><span class="status ${esc(statusClass(s))}">${esc(s.start_error ? 'failed to start' : statusLabel(st))}</span>
      <div class="actions head-actions">${buttons}</div></div>
      ${line ? `<p class="panel-sub">${line}</p>` : ''}
      ${s.start_error ? `<p class="error panel-error">${esc(s.start_error)}</p>` : ''}`
  }

  const AGENT_BUTTON = '<div class="actions agent-actions"><button class="primary" data-act="export">Let your agent deploy…</button></div>'

  function appsTab(s, ctx) {
    const extras = s.extras || {}
    const rows = appRows(s)
    // Let your agent deploy: here in both views, for the owner (the new token is theirs)
    const agent = (s.owner || 'admin') === ctx.me ? AGENT_BUTTON : ''
    if (!rows.length) return '<p class="muted">No apps yet — publish a port on all interfaces (e.g. 8080:8080) to get a link.</p>' + agent
    const mark = a => a === true ? ' <span class="ok" title="answering">✓</span><span class="sr-only">answering</span>'
      : a === false ? ' <span class="warn" title="not answering">⚠</span><span class="sr-only">not answering</span>' : ''
    const hub = s.hub || { published: [], unlinked: [] }
    const onHub = r => r.url && hub.published.includes(r.url)
      ? ` ${hub.url ? `<a class="tag" href="${esc(hub.url)}" target="_blank" rel="noopener">On the Hub</a>` : '<span class="tag">On the Hub</span>'}` : ''
    // Who may open it (p7y.access): no tag for public
    const ACCESS_TAG = { owner: 'Owner only', domain: 'Your domain' }
    const accessTag = r => ACCESS_TAG[r.access] ? ` <span class="tag" title="p7y.access: ${esc(r.access)}">${ACCESS_TAG[r.access]}</span>` : ''
    const body = rows.map(r => `<tr>
      <td>${esc(r.service)}</td>
      <td>${r.url ? `<a href="${esc(ctx.protocol)}//${esc(r.url)}" target="_blank" rel="noopener" title="${esc(r.url)}">open ↗</a>${mark(r.answers)}${accessTag(r)}${onHub(r)}` : '<span class="muted">—</span>'}</td>
      ${ctx.simple ? '' : `<td>${r.tcp ? `<span class="tcp">${esc(r.tcp.address)}</span> ${copyButton(r.tcp.address)}` : ''}</td>
      <td>${r.tcp ? `<button class="link" data-connect="${esc(r.tcp.address)}" data-port="${esc(r.tcp.port ?? '')}" data-user="${esc(r.tcp.user ?? '')}"${extras.demo_password ? ` data-demo-password="${esc(extras.demo_password)}"` : ''}>Connect…</button>` : ''}</td>`}
    </tr>`)
    const down = rows.filter(r => r.answers === false).map(r => r.service)
    const tip = !down.length ? ''
      : down.length === 1 ? `<p class="not-answering">⚠ ${esc(down[0])} is not answering — does it listen on 0.0.0.0 (not 127.0.0.1) inside its container?</p>`
      : `<p class="not-answering">⚠ ${down.map(esc).join(', ')} are not answering — do they listen on 0.0.0.0 (not 127.0.0.1) inside their containers?</p>`
    const asleep = s.status !== 'running' && rows.some(r => r.url) ? '<p class="muted">opening one wakes the sandbox</p>' : ''
    return table(ctx.simple ? ['App', 'Web'] : ['App', 'Web', 'TCP', ''], body, 'apps-table') + tip + asleep + agent
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
        // Asleep: docker gets only EOF until the sandbox is woken
        ...(da.hint ? [kv('', `<span class="muted">${esc(da.hint)}</span>`)] : []),
      ]))
    }
    if ((s.owner || 'admin') === ctx.me) parts.push(table(['API', ''], [kv('Token', '<button data-act="token">Token for this sandbox…</button>')]))
    // What a coding agent needs, for the owner (the new token is theirs), whatever the Docker access state
    if ((s.owner || 'admin') === ctx.me) parts.unshift(AGENT_BUTTON)
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

  // What the owner may want to fix: published apps the Hub cannot show as asked
  function warnings(s) {
    const hub = s.hub || {}
    const lines = [
      ...(hub.unlinked || []).map(n => `${esc(n)}: published, but has no web address (publish a port on all interfaces)`),
      ...(hub.bad_image || []).map(n => `${esc(n)}: p7y.image is ignored: use a path inside the app, e.g. /shot.png`),
      ...(s.apps || []).filter(a => a.access_invalid).map(a => `${esc(a.service)}: p7y.access is not public, domain or owner; only the owner can open it`),
      ...(hub.owner_only || []).map(n => `${esc(n)}: published, but only its owner can open it: set p7y.access: domain`),
    ]
    return lines.length ? `<div class="warnings"><h3>Warnings</h3><ul>${lines.map(l => `<li>⚠ ${l}</li>`).join('')}</ul></div>` : ''
  }

  function settingsTab(s, ctx) {
    const created = parseCreated(s.created_at)
    const when = created ? `${esc(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(created))} <span class="muted">(${relativeAge(created, ctx.now)})</span>` : esc(s.created_at || '—')
    const sleep = `${s.idle_timeout === 'off' ? 'never sleeps' : `after ${esc(s.idle_timeout || '—')} idle`} · ${s.deep_sleep_after === 'off' ? 'no deep sleep' : `deep sleep ${esc(s.deep_sleep_after || '—')} after`} <button class="link" data-act="sleep">Change…</button>`
    return table(null, [
      ...(ctx.isAdmin && !ctx.simple ? [kv('Owner', esc(s.owner === 'admin' ? 'admin API' : s.owner))] : []),
      ...(ctx.simple ? [] : [kv('Runtime · Template', `${esc([s.runtime, s.template].filter(Boolean).join(' · ') || '—')}${s.compose === 'edited' ? ' <span class="muted">(edited)</span>' : ''}`)]),
      kv('Created', when),
      // When it last ran (~ when only estimated), the exact time on hover
      kv('Last ran', s.status === 'running' ? 'now (running)'
        : s.last_running_at ? `<span title="${esc(new Date(s.last_running_at).toLocaleString())}">${s.last_running_estimated ? '~' : ''}${esc(ago(s.last_running_at, ctx.now))}</span>`
        : '<span class="muted">unknown</span>'),
      ...((s.status === 'exited' || s.status === 'created') && s.deep_sleep_after !== 'off' && s.deep_sleep_at
        ? [kv('Deep sleep', `in ${countdown(s.deep_sleep_at, ctx.now)}`)] : []),
      kv('Sleep', sleep),
      ...(ctx.simple ? [] : [kv('Compose', '<button class="link" data-act="compose">Starter stack…</button>')]),
    ]) + warnings(s) + `<div class="danger-zone"><h3>Danger zone</h3><div class="actions">${s.status !== 'deep_sleep' ? '<button data-act="deep-sleep">Deep sleep now</button>' : ''}<button class="danger" data-act="delete">Archive…</button></div></div>`
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

  // ---------- the Files tab (GET /sandboxes/:name/files) ----------
  const fileSize = b => b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${Math.round(b / 1024)} KB` : fmtBytes(b)
  const VOLUME_ROOT = /^\/var\/lib\/docker\/volumes\/[^/]+\/_data/
  const rootChips = (roots, on) => roots.map(r => `<button class="files-root${r === on ? ' on' : ''}" data-files-path="${esc(r)}">${esc(r)}</button>`).join('')
    + `<button class="files-root${on === 'volumes' ? ' on' : ''}" data-files-volumes title="The volumes of the apps in this sandbox's own Docker">Volumes</button>`
  const userName = u => u.service && u.service !== u.name ? `${u.service} (${u.name})` : u.name
  function filesView(d, ctx) {
    const href = p => `/sandboxes/${encodeURIComponent(ctx.name)}/files/content?path=${encodeURIComponent(p)}`
    // In a volume of the inner Docker: its folder is the root, shown by the volume's name
    const volRoot = VOLUME_ROOT.exec(d.path)?.[0]
    const root = volRoot || d.roots.find(r => d.path === r || d.path.startsWith(`${r}/`)) || d.roots[0]
    const rootLabel = volRoot ? volRoot.split('/')[5] : root
    let at = root
    const crumbs = [`<button class="link" data-files-path="${esc(root)}">${esc(rootLabel)}</button>`,
      ...d.path.slice(root.length).split('/').filter(Boolean).map(seg => { at += `/${seg}`; return `<button class="link" data-files-path="${esc(at)}">${esc(seg)}</button>` })].join(' / ')
    const rows = d.entries.map(e => {
      const p = `${d.path}/${e.name}`
      const name = e.type === 'dir' ? `<button class="link" data-files-path="${esc(p)}">${esc(e.name)}/</button>`
        : e.type === 'file' ? `<a href="${href(p)}" download>${esc(e.name)}</a>`
        : `<span class="muted" title="${e.type === 'link' ? 'a link' : 'not a regular file'}">${esc(e.name)}${e.type === 'link' ? ' →' : ''}</span>`
      return `<tr><td class="files-name">${name}</td><td>${e.type === 'dir' ? '<span class="muted">—</span>' : fileSize(e.size)}</td><td class="muted">${relativeAge(new Date(e.mtime), ctx.now)}</td><td><button class="link danger-link" data-files-delete="${esc(p)}">Delete</button></td></tr>`
    })
    const running = volRoot ? (ctx.volume?.containers || []).filter(u => u.running) : []
    const warning = running.length ? `<p class="warn files-warn">${running.map(u => esc(userName(u))).join(', ')} ${running.length === 1 ? 'is' : 'are'} running and using this volume: a copy of a database's files taken while it runs may not be consistent, and changes here may surprise it. Stop the app first for that.</p>` : ''
    const note = volRoot ? "A volume of an app in this sandbox's own Docker; it is kept over a deep sleep. Uploaded files belong to root (readable by everyone)."
      : "Only /root, /home, /srv and /opt are shown: they are kept over a deep sleep. The apps' own data is under Volumes."
    return `<div class="files-roots">${rootChips(d.roots, volRoot ? 'volumes' : root)}</div>
      ${warning}
      <div class="files-bar"><span class="files-crumbs">${crumbs}</span>
        <span class="files-tools"><label class="button-like">Upload…<input type="file" multiple data-files-input hidden></label>
        <form data-files-mkdir><input name="folder" placeholder="new folder" aria-label="New folder name" required><button>New folder</button></form>
        <a href="${href(d.path)}" download title="This folder as a .tar">Download folder</a></span></div>
      ${rows.length ? table(['Name', 'Size', 'Modified', ''], rows, 'files-table') : '<p class="muted files-empty">Empty: drop files here, or Upload…</p>'}
      <p class="muted files-note">Drop files here to upload them, up to ${fmtBytes(d.max_upload)} a file. ${note}</p>
      <p class="muted" data-files-status hidden></p>`
  }

  // ---------- the Files tab's Volumes (GET /sandboxes/:name/volumes) ----------
  function volumesView(d, ctx) {
    const roots = ctx.roots || ['/root', '/home', '/srv', '/opt']
    const rows = d.volumes.map(v => {
      const users = v.containers.length ? v.containers.map(u => `${esc(userName(u))} <span class="muted">at ${esc(u.mount)}${u.running ? '' : ', stopped'}</span>`).join('<br>') : '<span class="muted">no container</span>'
      return `<tr><td class="files-name"><button class="link" data-files-path="${esc(v.path)}">${esc(v.name)}/</button></td><td>${v.project ? esc(v.project) : '<span class="muted">—</span>'}</td><td>${users}</td></tr>`
    })
    return `<div class="files-roots">${rootChips(roots, 'volumes')}</div>
      ${rows.length ? table(['Volume', 'Project', 'Used by'], rows, 'files-table') : `<p class="muted files-empty">No volumes in this sandbox's Docker yet.</p>`}
      <p class="muted files-note">The volumes of the apps in this sandbox's own Docker (a database's data, an app's uploads). They are kept over a deep sleep.</p>
      <p class="muted" data-files-status hidden></p>`
  }

  /** The tabs shown: Simple has only Apps and Details */
  const SIMPLE_TABS = ['apps', 'settings']
  const tabsOf = ctx => ctx.simple ? TABS.filter(([id]) => SIMPLE_TABS.includes(id)) : TABS

  /** Right after a click, from the list's row: the new sandbox's name and status at once, never the previous one's
   * details while its own load (on a slow or busy server that takes seconds) */
  function loadingPanel(s, ctx) {
    return `<div class="panel-head"><h2>${esc(ctx.shortName(s.name))}</h2><span class="status ${esc(statusClass(s))}">${esc(statusLabel(s.status))}</span></div>
      <p class="muted">Loading…</p>`
  }

  function renderPanel(s, ctx) {
    const shown = tabsOf(ctx)
    const tab = shown.some(([id]) => id === ctx.tab) ? ctx.tab : 'apps'
    const tabs = shown.map(([id, label]) => `<button role="tab" id="tab-${id}" aria-selected="${id === tab}" aria-controls="tabpanel-${id}" tabindex="${id === tab ? 0 : -1}" data-tab="${id}">${label}</button>`).join('')
    const body = {
      apps: appsTab(s, ctx),
      access: accessTab(s, ctx),
      resources: `<div data-resources>${resourcesTable(s)}</div><div class="actions"><button data-act="resources">Change limits…</button></div>`,
      registry: '<div data-registry><p class="muted">Loading…</p></div>',
      files: s.status === 'running' ? '<div data-files><p class="muted">Loading…</p></div>'
        : `<p class="muted">The sandbox is ${esc(statusLabel(s.status))}: wake it to see its files.</p><div class="actions"><button data-act="start">Wake</button></div>`,
      settings: settingsTab(s, ctx),
    }
    return `${header(s, ctx)}
      <div class="tabs" role="tablist" aria-label="Sandbox details">${tabs}</div>
      ${shown.map(([id]) => `<div role="tabpanel" id="tabpanel-${id}" aria-labelledby="tab-${id}" data-tabpanel="${id}"${id === tab ? '' : ' hidden'}>${body[id]}</div><!--/${id}-->`).join('')}
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
      // Only running sandboxes take a place: asleep or in deep sleep they take none
      const taking = list.filter(s => s.status === 'running')
      const used = taking.length, adm = taking.filter(s => (s.owner || 'admin') === 'admin').length
      const ofAdmin = adm ? ` · ${adm} of them the admin's` : ''
      const lim = sum.server_limit
      first = lim
        ? card('allowed', 'Sandbox places used', ring(used, lim), `${used}<small> / ${lim}</small>`, `server limit · ${Math.max(0, lim - used)} free${ofAdmin}`, listHref(''))
        : card('allowed', 'Sandbox places used', ring(0, 1), `${used}`, `no server limit${ofAdmin}`, listHref(''))
    } else if (sum.server_full) {
      first = card('allowed warn', 'Server', '⚠', 'full', 'the server is full: ask the administrator', '/')
    }
    // A user's quota counts running sandboxes only: asleep and deep-sleeping ones are free
    const q = ctx.isAdmin ? null : c.quota
    // SANDBOX_QUOTA_MAX: above the guarantee while the server has room (max_running null: no maximum)
    const max = ctx.isAdmin || q === null ? q : sum.max_running === undefined ? q : sum.max_running
    const room = max === null ? 'more while the server has room' : `up to ${max} while the server has room`
    const runningSub = q === null ? (c.running ? 'awake, serving' : 'nothing awake')
      : max !== null && c.running >= max ? 'limit reached: Wake lets you choose one to put to sleep'
      : max === q ? `${q - c.running} more can run`
      : c.running >= q ? `above the ${q} guaranteed · ${room}` : `${q - c.running} more guaranteed · ${room}`
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
    // The admin's bar is the server's places: running sandboxes against the limit (asleep ones take none); otherwise the split of the list
    const lim = ctx.isAdmin ? sum.server_limit : null
    // A user's: against their running limit while they have fewer sandboxes than that (two of two is not full)
    const runMax = ctx.isAdmin ? null : sum.max_running ?? c.quota
    const whole = lim ? Math.max(lim, c.running) : runMax ? Math.max(runMax, c.total) : c.total
    const pct = n => whole ? (n / whole * 100).toFixed(1) : 0
    const stack = `<div class="ov-stack"><span class="r" style="width:${pct(c.running)}%"></span>${lim ? '' : `<span class="a" style="width:${pct(c.asleep)}%"></span><span class="d" style="width:${pct(c.deep_sleep)}%"></span>`}</div>
      <div class="ov-legend"><span>${dot('running small')}${c.running} running</span><span>${dot('asleep small')}${c.asleep} asleep</span><span>${dot('deep small')}${c.deep_sleep} deep sleep</span>${lim ? `<span>${Math.max(0, lim - c.running)} free of ${lim} places</span>` : ''}</div>`
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
        return `<tr><td><a href="/admin?owner=${encodeURIComponent(o.owner)}">${esc(o.owner === 'admin' ? 'admin API' : o.owner)}</a></td><td>${o.total}</td><td>${qb}${dot('running small')}${o.running} / ${o.quota === null ? '∞' : o.quota}${o.quota !== null && o.max_running !== undefined && o.max_running !== o.quota ? ` (+${o.max_running === null ? '∞' : o.max_running - o.quota})` : ''}</td><td>${dot('asleep small')}${o.asleep}</td><td class="ov-hide">${dot('deep small')}${o.deep_sleep}</td><td class="ov-hide">${o.archived}</td></tr>`
      }).join('')
      out += `<section class="ov-box"><h2>Per owner</h2><div class="ov-tablewrap"><table class="ov-table"><thead><tr><th>Owner</th><th>Sandboxes</th><th>Running</th><th>Asleep</th><th class="ov-hide">Deep sleep</th><th class="ov-hide">Archived</th></tr></thead><tbody>${ownerRows}</tbody></table></div><p class="ov-note">An owner opens All sandboxes, filtered to them.</p></section>`
    } else if (list.length) {
      const label = { running: 'running', exited: 'asleep', deep_sleep: 'deep sleep' }
      const cls = { running: 'running', deep_sleep: 'deep' }
      out += `<section class="ov-box"><h2>Your sandboxes</h2><div class="ov-tablewrap"><table class="ov-table"><thead><tr><th>Name</th><th>Status</th><th>Disk</th></tr></thead><tbody>${list.map(s => `<tr><td><strong>${name(s.name)}</strong></td><td>${dot(`${cls[s.status] || 'asleep'} small`)}${label[s.status] || esc(s.status)}</td><td>${s.disk && s.disk.used !== null ? `${s.disk.over ? '⚠ ' : ''}${fmtBytes(s.disk.used)} <span class="muted">/ ${fmtBytes(s.disk.limit)}</span>` : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div></section>`
    }
    return out
  }

  /**
   * What a user pastes into a terminal to install the Claude Code plugin with this Purgatory's address and a token.
   * Only plain URL and token characters go in: nothing a shell would read as more than one argument.
   */
  function pluginInstallCommand(url, token) {
    const u = String(url).replace(/\/+$/, '')
    if (!/^https?:\/\/[A-Za-z0-9.:-]+$/.test(u)) throw new Error(`not an address: ${u}`)
    if (!/^p7y_[A-Za-z0-9_-]+$/.test(token)) throw new Error('not a token')
    return 'claude plugin marketplace add p7y-dev/p7y\n' +
      `claude plugin install p7y@p7y --scope user --config p7y_url=${u} --config p7y_token=${token}`
  }

  const api = { matchesFilter, loadingPanel, pluginInstallCommand, filesView, volumesView, quotaLine, placesBadge, overviewHtml, countsOf, esc, TABS, statusLabel, statusClass, remaining, countdown, fmtBytes, meter, portainerShown, parseCreated, relativeAge, appRows, resourcesTable, registryTable, renderPanel }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.P7yPanel = api
})(typeof window !== 'undefined' ? window : globalThis)
