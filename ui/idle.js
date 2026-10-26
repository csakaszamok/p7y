// Signed out after SESSION_IDLE_TIMEOUT without doing anything: a click, a key (also in a terminal), a scroll
// starts the time again (POST /me/active, at most once a minute); background polls do not. Two minutes before
// the end a bar offers to stay; then to the sign-in page, and after signing in back to this page.
(function () {
  const RETURN_KEY = 'p9m-return'
  const WARN_S = 120
  // Back where the user was signed out (sessionStorage: this tab only)
  try {
    const back = sessionStorage.getItem(RETURN_KEY)
    if (back) {
      sessionStorage.removeItem(RETURN_KEY)
      if (back !== location.pathname + location.search && back.startsWith('/') && !back.startsWith('//')) { location.replace(back); return }
    }
  } catch { /* no storage */ }

  let deadline = null // ms, local clock
  let lastPing = Date.now()
  let bar = null

  const call = async method => {
    const res = await fetch('/me/active', { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } })
    if (res.status === 401) return null
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }
  const apply = d => {
    if (!d) return signOut()
    deadline = d.idle_left === null ? null : Date.now() + d.idle_left * 1000
    if (bar && (deadline === null || deadline - Date.now() > WARN_S * 1000)) { bar.remove(); bar = null }
  }
  function signOut() {
    try { sessionStorage.setItem(RETURN_KEY, location.pathname + location.search) } catch { /* no storage */ }
    location.href = '/login'
  }
  const active = () => call('POST').then(apply, () => {})

  function showBar(left) {
    if (!bar) {
      bar = document.createElement('div')
      bar.className = 'idle-bar'
      bar.setAttribute('role', 'alert')
      bar.innerHTML = '<span data-idle-text></span><button type="button" class="primary">Stay signed in</button>'
      bar.querySelector('button').addEventListener('click', () => { lastPing = Date.now(); active() })
      document.body.appendChild(bar)
    }
    const s = Math.max(0, Math.ceil(left / 1000))
    bar.querySelector('[data-idle-text]').textContent = `You will be signed out in ${s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`} for doing nothing.`
  }

  // Doing something: at most one renewal a minute
  const onInput = () => {
    // While the bar shows, any click or key counts at once
    if (!bar && Date.now() - lastPing < 60_000) return
    lastPing = Date.now()
    active()
  }
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, onInput, { passive: true, capture: true })

  setInterval(async () => {
    if (deadline === null) return
    const left = deadline - Date.now()
    if (left > WARN_S * 1000) { if (bar) { bar.remove(); bar = null } return }
    // Another tab may have kept the session going: ask before warning or signing out
    const d = await call('GET').catch(() => undefined)
    if (d === undefined) return // offline: try again
    apply(d)
    if (!d || deadline === null) return
    const now = deadline - Date.now()
    if (now <= 0) signOut()
    else if (now <= WARN_S * 1000) showBar(now)
  }, 5000)

  // Opening this page renewed the session already; learn how long it has
  call('GET').then(apply, () => {})
})()
