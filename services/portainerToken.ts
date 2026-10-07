import { requestViaTraefik } from './wake'

export type PortainerCall = (host: string, method: string, path: string, opts?: { body?: unknown; headers?: Record<string, string> }) => Promise<{ status: number; text: string }>

interface SandboxLike { name: string; status: string; tunnel_urls: string[]; extras: Record<string, string> }

/** Through Traefik, like a browser: the sandbox router wakes the sandbox and keeps it awake while we talk. */
const viaTraefik: PortainerCall = async (host, method, path, opts = {}) => {
  const { status, body } = await requestViaTraefik(host, method, path, { headers: opts.headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  return { status, text: body }
}

const hostOf = (u: string) => u.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '').toLowerCase()
const json = (text: string): Record<string, unknown> | null => { try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : null } catch { return null } }

/**
 * A Portainer API token (`X-API-Key`) for a coding agent, made as the sandbox's Portainer admin, so the agent
 * never gets the admin password. It lives until someone deletes it in Portainer (My account → Access tokens).
 * Never throws: when there is no token to give, `skipped` says why, and the export goes on without it.
 */
export async function portainerAccess(
  sandbox: SandboxLike,
  description: string,
  deps: { call?: PortainerCall; wake?: (name: string) => Promise<void>; deadlineMs?: number; retryMs?: number } = {},
): Promise<{ url: string; token: string } | { skipped: string }> {
  const { portainer_url: url, portainer_password: password } = sandbox.extras ?? {}
  if (!url || !password) return { skipped: 'this sandbox has no Portainer' }
  const host = hostOf(url)
  // Published on 127.0.0.1: no tunnel, so no address an agent could use
  if (!(sandbox.tunnel_urls ?? []).map(hostOf).includes(host)) return { skipped: 'Portainer is private to the sandbox (published on 127.0.0.1)' }
  const call = deps.call ?? viaTraefik
  const deadline = Date.now() + (deps.deadlineMs ?? 120_000)
  const retryMs = deps.retryMs ?? 2000
  try {
    if (sandbox.status !== 'running') {
      const wake = deps.wake ?? (async (n: string) => { const { sandboxService } = await import('./sandbox'); await sandboxService.startSandbox(n) })
      try { await wake(sandbox.name) } catch (err) { return { skipped: `could not wake the sandbox: ${err instanceof Error ? err.message : err}` } }
    }
    // While the sandbox wakes, its address answers with an HTML waiting page
    for (;;) {
      const r = await call(host, 'GET', '/api/status').catch(() => null)
      if (r && r.status === 200 && json(r.text)?.Version) break
      if (Date.now() >= deadline) return { skipped: 'Portainer did not answer in time' }
      await new Promise(res => setTimeout(res, retryMs))
    }
    const auth = await call(host, 'POST', '/api/auth', { body: { username: 'admin', password } })
    const jwt = json(auth.text)?.jwt
    if (auth.status !== 200 || typeof jwt !== 'string') return { skipped: 'Portainer refused the admin password Purgatory knows (changed in Portainer?)' }
    const headers = { Authorization: `Bearer ${jwt}` }
    const me = await call(host, 'GET', '/api/users/me', { headers })
    const id = json(me.text)?.Id ?? 1
    const made = await call(host, 'POST', `/api/users/${id}/tokens`, { body: { description, password }, headers })
    const token = json(made.text)?.rawAPIKey
    if (typeof token !== 'string') return { skipped: `Portainer made no token (HTTP ${made.status})` }
    return { url, token }
  } catch (err) {
    return { skipped: `could not reach Portainer: ${err instanceof Error ? err.message : err}` }
  }
}
