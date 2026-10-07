// Sandbox app logs: EventSource on /sandboxes/<name>/logs/stream, newest at the bottom
const name = document.body.dataset.sandbox
const $ = s => document.querySelector(s)
const view = $('[data-log]')
const status = $('[data-log-status]')
const again = $('[data-log-reconnect]')
const startBtn = $('[data-log-start]')
const filter = $('[data-log-filter]')
const pauseBtn = $('[data-log-pause]')
const newer = $('[data-log-newer]')
const MAX = 5000
const PALETTE = ['#7dd3fc', '#86efac', '#fcd34d', '#f9a8d4', '#c4b5fd', '#fdba74', '#5eead4', '#a5b4fc']
const colors = new Map()
const colorOf = s => { if (!colors.has(s)) colors.set(s, PALETTE[colors.size % PALETTE.length]); return colors.get(s) }
let es = null
let paused = false
let held = []
let queue = []
let scheduled = false
let stick = true
let retryUntil = 0

const time = t => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) }

function addService(s) {
  if (colors.has(s)) return
  colorOf(s)
  const o = document.createElement('option')
  o.value = s
  o.textContent = s
  filter.append(o)
}
function row(l) {
  const el = document.createElement('div')
  el.className = l.stream === 'err' ? 'log-line err' : l.marker ? 'log-line marker' : 'log-line'
  el.dataset.service = l.service
  if (filter.value && filter.value !== l.service) el.hidden = true
  const ts = document.createElement('span'); ts.className = 'log-time'; ts.textContent = time(l.t)
  const sv = document.createElement('span'); sv.className = 'log-service'; sv.style.color = colorOf(l.service); sv.textContent = l.service
  const tx = document.createElement('span'); tx.className = 'log-text'; tx.textContent = l.line
  el.append(ts, sv, tx)
  return el
}
function show(lines) {
  const frag = document.createDocumentFragment()
  for (const l of lines) { addService(l.service); frag.append(row(l)) }
  view.append(frag)
  while (view.childElementCount > MAX) view.firstElementChild.remove()
  if (stick) view.scrollTop = view.scrollHeight
  else newer.hidden = false
}
function enqueue(l) {
  if (paused) { held.push(l); if (held.length > MAX) held.shift(); return }
  queue.push(l)
  if (queue.length > MAX) queue.shift()
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => { scheduled = false; const q = queue; queue = []; show(q) })
}

function connect() {
  if (es) es.close()
  again.hidden = true
  startBtn.hidden = true
  status.textContent = 'connecting…'
  const src = new EventSource(`/sandboxes/${encodeURIComponent(name)}/logs/stream`)
  es = src
  src.addEventListener('line', e => enqueue(JSON.parse(e.data)))
  src.addEventListener('stopped', e => enqueue({ t: new Date().toISOString(), service: JSON.parse(e.data).service, stream: 'out', line: '— stopped —', marker: true }))
  src.addEventListener('status', e => {
    const s = JSON.parse(e.data)
    status.textContent = s.text
    if (s.status === 'asleep') { src.close(); startBtn.hidden = false }
    else if (s.status === 'error' && Date.now() < retryUntil) { src.close(); setTimeout(connect, 2000) } // just started: its Docker is still coming up
    else if (s.status === 'stopped' || s.status === 'error') { src.close(); again.hidden = false }
  })
  // The browser would retry on its own forever (and knock on a sleeping sandbox): only the buttons reconnect
  src.onerror = () => {
    if (es !== src) return
    src.close()
    if (startBtn.hidden && again.hidden) { status.textContent = 'disconnected'; again.hidden = false }
  }
}

view.addEventListener('scroll', () => {
  stick = view.scrollTop + view.clientHeight >= view.scrollHeight - 4
  if (stick) newer.hidden = true
})
newer.addEventListener('click', () => { stick = true; view.scrollTop = view.scrollHeight; newer.hidden = true })
filter.addEventListener('change', () => {
  for (const el of view.children) el.hidden = Boolean(filter.value) && el.dataset.service !== filter.value
  if (stick) view.scrollTop = view.scrollHeight
})
pauseBtn.addEventListener('click', () => {
  paused = !paused
  pauseBtn.textContent = paused ? 'Resume' : 'Pause'
  if (!paused) { const h = held; held = []; for (const l of h) enqueue(l) }
})
$('[data-log-clear]').addEventListener('click', () => { view.replaceChildren(); newer.hidden = true })
again.addEventListener('click', connect)
startBtn.addEventListener('click', async () => {
  startBtn.disabled = true
  status.textContent = 'starting…'
  try {
    const res = await fetch(`/sandboxes/${encodeURIComponent(name)}/start`, { method: 'POST' })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
    retryUntil = Date.now() + 30_000
    connect()
  } catch (e) { status.textContent = e.message; startBtn.hidden = false } finally { startBtn.disabled = false }
})
connect()
