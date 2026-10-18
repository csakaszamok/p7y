// The Hub page: the list from /api/hub, search, sort (Popular/New), filter, votes. No framework.
const $ = s => document.querySelector(s)
const state = { apps: [], q: '', sort: 'popular', filter: 'all' }
const ago = iso => {
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  const d = Math.round(s / 86400)
  return d < 14 ? `${d} days ago` : d < 60 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`
}
const text = (tag, cls, t) => { const e = document.createElement(tag); if (cls) e.className = cls; if (t !== undefined) e.textContent = t; return e }
const STATUS = { running: ['● running', 'run'], asleep: ['◐ asleep', 'sleep'], deep_sleep: ['○ deep sleep', 'sleep'] }

function visible() {
  const q = state.q.trim().toLowerCase()
  return state.apps
    .filter(a => state.filter === 'all' || (state.filter === 'running' ? a.status === 'running' : a.status !== 'running'))
    .filter(a => !q || [a.title, a.description, a.owner_name ?? a.owner].some(v => v.toLowerCase().includes(q)))
    .sort((a, b) => state.sort === 'popular' ? (b.votes - a.votes) || b.updated_at.localeCompare(a.updated_at) : b.updated_at.localeCompare(a.updated_at))
}

function render() {
  const list = $('#apps')
  list.replaceChildren()
  const apps = visible()
  $('#empty').hidden = state.apps.length > 0
  for (const a of apps) {
    const li = text('li', 'app')
    const main = text('div', 'main')
    main.append(text('h2', null, a.title))
    if (a.description) main.append(text('p', 'desc', a.description))
    main.append(text('p', 'meta', `${a.owner_name ?? a.owner} · ${ago(a.updated_at)}`))
    const side = text('div', 'side')
    const [label, cls] = STATUS[a.status] ?? STATUS.asleep
    side.append(text('span', `status ${cls}`, label))
    const vote = text('button', `vote${a.voted ? ' on' : ''}`, `👍 ${a.votes}`)
    vote.disabled = a.mine
    vote.title = a.mine ? 'Your app' : a.voted ? 'Take your vote back' : 'Vote'
    vote.setAttribute('aria-pressed', String(a.voted))
    vote.onclick = () => toggleVote(a)
    const open = text('a', 'primary', 'Open ↗')
    open.href = a.url; open.target = '_blank'; open.rel = 'noopener'
    side.append(vote, open)
    if (a.status !== 'running') side.append(text('span', 'hint', 'wakes in ~10 s'))
    li.append(main, side)
    list.append(li)
  }
}

async function toggleVote(a) {
  const res = await fetch(`/api/hub/apps/${encodeURIComponent(a.id)}/vote`, { method: a.voted ? 'DELETE' : 'PUT' })
  if (!res.ok) return
  Object.assign(a, await res.json())
  render()
}

async function load() {
  const res = await fetch('/api/hub')
  if (res.status === 401) { location.href = '/login'; return }
  state.apps = (await res.json()).apps
  render()
}

$('#q').oninput = e => { state.q = e.target.value; render() }
for (const id of ['sort', 'filter']) {
  $(`#${id}`).onclick = e => {
    const b = e.target.closest('button'); if (!b) return
    for (const x of $(`#${id}`).children) x.classList.toggle('on', x === b)
    state[id] = b.dataset.v; render()
  }
}
load()
setInterval(load, 60_000)
