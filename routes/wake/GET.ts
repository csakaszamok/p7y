import { wakeByHost, movedAppHost } from '../../services/wake'
import { waitingPage } from '../../services/ui/waitingPage'
import type { WakeRefusal } from '../../services/quota'
import { decide } from '../../services/appAccess/decide'
import { userUrl } from '../../services/userHost'

export default async (req: Request): Promise<Response> => {
  const host = req.headers.get('host') ?? ''
  const path = (req.headers.get('x-replaced-path') ?? '/') + new URL(req.url).search
  // An app's address from before APPS_DOMAIN: the same app under it (a sandbox migrated at startup answers there)
  const moved = movedAppHost(host)
  if (moved) return new Response(null, { status: 308, headers: { Location: `${req.headers.get('x-forwarded-proto') ?? 'https'}://${moved}${path}`, 'Cache-Control': 'no-store' } })
  // An app that is not public: only someone who may open it gets to wake it (the original path is X-Replaced-Path)
  const gate = await decide({ host, proto: req.headers.get('x-forwarded-proto') ?? 'https', uri: path, cookie: req.headers.get('cookie') ?? '' })
  if (gate.status === 302) return new Response(null, { status: 302, headers: gate.headers })
  const { result, name, from, refusal } = await wakeByHost(host)
  if (result === 'not_found' || !name) return new Response('Not found', { status: 404 })
  // Any request wakes a sleeping sandbox: say which one, e.g. a Portainer tab left open
  if (result === 'started') console.log(`[wake] ${name}: a request for ${host} (${req.headers.get('user-agent') ?? 'no user agent'}) wakes it from ${from === 'asleep' ? 'sleep' : 'deep sleep'}`)
  if (result === 'limit' && refusal) return limitPage(name, refusal)
  if (result === 'outdated') return messageResponse(409, name, 'This sandbox needs to be re-created',
    `It was created before HTTPS was enabled, so its address only works over plain HTTP, which now redirects to HTTPS.
  Delete it in Purgatorium (its data is archived) and create it again to get an HTTPS address.`)
  if (result === 'no_route') return messageResponse(502, name, 'This address does not reach the sandbox',
    `The sandbox is running, but none of its routes matches this address. If you opened it over https://, try http://.`)
  return new Response(wakingPage(name, from, `${publicBase()}/wake/ready?host=${encodeURIComponent(host)}`), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

// A sandbox app's visitors: the users' address (USER_HOST when on)
const publicBase = () => userUrl()

/** readyUrl: asked before opening the address, so the page waits until its app answers, not only its tunnel. */
function wakingPage(name: string, from: 'asleep' | 'deep_sleep' | undefined, readyUrl: string): string {
  // Only deep sleep rebuilds; a wake whose start is not known (a reload while it runs) is a plain wake
  const asleep = from !== 'deep_sleep'
  return waitingPage({
    title: 'Sandbox is waking up',
    name: escapeHtml(name),
    // From sleep it takes seconds; deep sleep rebuilds, which takes longer
    refreshSeconds: asleep ? 1 : 3,
    readyUrl: escapeHtml(readyUrl),
    body: `<div class="status" data-status><span class="dot starting"></span>${asleep ? 'waking up' : 'rebuilding after a long sleep'}</div>
  <div class="hint">${asleep ? 'This page updates by itself, in a few seconds.' : 'This page updates by itself. This can take up to a minute.'}</div>`,
  })
}

/** At the owner's limit: says which limit and what runs, where the owner chooses, and tries again every 30 s. */
function limitPage(name: string, r: WakeRefusal): Response {
  const base = publicBase()
  const text = r.reason === 'running'
    // A public page: the owner's other sandboxes (their addresses) are named only in the signed-in panel
    ? `This sandbox is asleep and cannot wake up: its owner reached their limit of ${r.limit} running sandbox${r.limit === 1 ? '' : 'es'}.`
    : r.reason === 'room'
    ? `This sandbox cannot wake up now: its owner has more than the ${r.limit} running sandbox${r.limit === 1 ? '' : 'es'} guaranteed to them, and the server has no room to spare for others' guarantees.`
    : `This sandbox cannot wake up: the server is full (${r.limit} sandboxes running).`
  const link = r.reason === 'running'
    ? `<a href="${escapeHtml(`${base}/?wake=${encodeURIComponent(name)}`)}">Choose what sleeps (owner)</a>`
    : `<a href="${escapeHtml(`${base}/`)}">Open Purgatorium (owner)</a>`
  return messageResponse(409, name, escapeHtml(r.title), `${text}</p><p>${link} · this page tries again every 30 seconds.`, '<meta http-equiv="refresh" content="30">')
}

function messageResponse(status: number, name: string, title: string, text: string, head = ''): Response {
  const n = escapeHtml(name)
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${head}
<title>${title} — ${n}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f0f0f; color: #e8e8e8;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0 }
  .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 40px 48px; max-width: 480px; width: 90% }
  h1 { font-size: 20px; margin: 0 0 8px } .name { color: #888; font-family: monospace; margin-bottom: 20px } p { color: #aaa; line-height: 1.5 }
  a { color: #7aa7ff }
</style></head>
<body><div class="card">
  <h1>${title}</h1>
  <div class="name">${n}</div>
  <p>${text}</p>
</div></body></html>`
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}
