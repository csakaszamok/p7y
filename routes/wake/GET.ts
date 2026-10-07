import { wakeByHost } from '../../services/wake'
import { waitingPage } from '../../services/ui/waitingPage'
import type { WakeRefusal } from '../../services/quota'

export default async (req: Request): Promise<Response> => {
  const host = req.headers.get('host') ?? ''
  const { result, name, from, refusal } = await wakeByHost(host)
  if (result === 'not_found' || !name) return new Response('Not found', { status: 404 })
  // Any request wakes a sleeping sandbox: say which one, e.g. a Portainer tab left open
  if (result === 'started') console.log(`[wake] ${name}: a request for ${host} (${req.headers.get('user-agent') ?? 'no user agent'}) wakes it from ${from === 'asleep' ? 'sleep' : 'deep sleep'}`)
  if (result === 'limit' && refusal) return limitPage(name, refusal)
  if (result === 'outdated') return messageResponse(409, name, 'This sandbox needs to be re-created',
    `It was created before HTTPS was enabled, so its address only works over plain HTTP, which now redirects to HTTPS.
  Delete it in Purgatory (its data is archived) and create it again to get an HTTPS address.`)
  if (result === 'no_route') return messageResponse(502, name, 'This address does not reach the sandbox',
    `The sandbox is running, but none of its routes matches this address. If you opened it over https://, try http://;
  restarting Purgatory updates the routes of sandboxes created before HTTPS support.`)
  return new Response(wakingPage(name, from), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function wakingPage(name: string, from?: 'asleep' | 'deep_sleep'): string {
  const asleep = from === 'asleep'
  return waitingPage({
    title: 'Sandbox is waking up',
    name: escapeHtml(name),
    refreshSeconds: 3,
    body: `<div class="status" data-status><span class="dot starting"></span>${asleep ? 'waking up' : 'rebuilding after a long sleep'}</div>
  <div class="hint">${asleep ? 'This page updates by itself, in a few seconds.' : 'This page updates by itself. This can take up to a minute.'}</div>`,
  })
}

/** At the owner's limit: says which limit and what runs, where the owner chooses, and tries again every 30 s. */
function limitPage(name: string, r: WakeRefusal): Response {
  const base = (process.env.PUBLIC_URL ?? `https://p7y.${(process.env.HOST_DOMAIN ?? 'lvh.me').toLowerCase()}`).replace(/\/$/, '')
  const text = r.reason === 'running'
    // A public page: the owner's other sandboxes (their addresses) are named only in the signed-in panel
    ? `This sandbox is asleep and cannot wake up: its owner reached their limit of ${r.limit} running sandbox${r.limit === 1 ? '' : 'es'}.`
    : `This sandbox cannot wake up: the server is full (${r.limit} sandboxes running or asleep).`
  const link = r.reason === 'running'
    ? `<a href="${escapeHtml(`${base}/?wake=${encodeURIComponent(name)}`)}">Choose what sleeps (owner)</a>`
    : `<a href="${escapeHtml(`${base}/`)}">Open Purgatory (owner)</a>`
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
