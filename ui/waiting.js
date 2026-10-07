// Waiting page: instead of reloading the whole page (which would restart the ember
// animation), fetch it in the background every few seconds. While it is still a
// waiting page, update the container list in place; once it is something else
// (the app answers, or an error page), reload to show it. Without JavaScript the
// page's <noscript> meta refresh does the same, more plainly.
;(() => {
  const root = document.querySelector('[data-p7y-waiting]')
  if (!root) return
  const every = Math.max(1, Number(root.getAttribute('data-refresh')) || 3) * 1000
  const coal = document.querySelector('[data-coal]')

  function allReady(doc) {
    const states = [...doc.querySelectorAll('[data-state]')].map(el => el.getAttribute('data-state'))
    return states.length > 0 && states.every(s => s === 'ready')
  }

  async function poll() {
    try {
      const res = await fetch(location.href, { cache: 'no-store', credentials: 'same-origin' })
      const text = await res.text()
      const doc = new DOMParser().parseFromString(text, 'text/html')
      const next = doc.querySelector('[data-p7y-waiting]')
      // The app answers: everything is ready. Let the ember become a flame for a moment, then open it
      if (!next) {
        for (const el of document.querySelectorAll('[data-state]')) {
          el.setAttribute('data-state', 'ready'); el.className = ''; el.innerHTML = '<span class="dot ready"></span>ready'
        }
        if (coal) coal.classList.add('ready')
        setTimeout(() => location.reload(), coal ? 900 : 0)
        return
      }
      for (const sel of ['[data-states]', '[data-status]']) {
        const from = doc.querySelector(sel), to = document.querySelector(sel)
        if (from && to && from.innerHTML !== to.innerHTML) to.innerHTML = from.innerHTML
      }
      if (coal) coal.classList.toggle('ready', allReady(doc))
    } catch {
      // network blip: try again on the next round
    }
    setTimeout(poll, every)
  }

  if (coal) coal.classList.toggle('ready', allReady(document))
  setTimeout(poll, every)
})()
