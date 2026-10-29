// /activate: a click on Approve or Deny swaps the buttons for a busy one with its data-busy text until the answer comes
// (creating a sandbox takes up to a minute); the hidden field sends the choice the gone button would have
document.querySelectorAll('form[data-activate]').forEach(form => form.addEventListener('submit', e => {
  const b = e.submitter
  if (!b || !b.name) return
  const decision = document.createElement('input')
  decision.type = 'hidden'
  decision.name = b.name
  decision.value = b.value
  form.appendChild(decision)
  const busy = document.createElement('button')
  busy.type = 'button'
  busy.className = 'busy'
  busy.disabled = true
  busy.textContent = b.dataset.busy || 'Working…'
  form.querySelector('.actions').replaceChildren(busy)
}))

// The confirmation code, selected (for Ctrl+C, when the clipboard is refused or slow to ask) and onto the clipboard
document.querySelectorAll('[data-copy-from]').forEach(copy => copy.addEventListener('click', async () => {
  const el = document.querySelector(copy.dataset.copyFrom)
  if (!el?.textContent) return
  const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r)
  try { await navigator.clipboard.writeText(el.textContent.trim()); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy' }, 1500) } catch {}
}))
