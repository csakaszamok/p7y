import { requirePrincipal } from './principal'
import { getOwnedSandbox } from './access'
import { safePath } from './sandboxFiles'

/** What a Files route gets: the sandbox's name, the request's URL and its checked path (null if it gave none). */
export interface FilesCall { name: string; url: URL; path: string | null }

// The service's errors → status codes; anything else is a 500
const STATUS: Array<[RegExp, number]> = [
  [/not found|^No such/, 404],
  [/^Only \/root|^Not a |^A folder|^Too big|cannot be removed|^Give a path/, 400],
]

/**
 * The owner (or the admin) of a running sandbox; the path (?path= or from the body) only inside the folders that
 * outlive a deep sleep. A sleeping sandbox: 409 with reason not_running (waking it is the caller's choice).
 */
export async function filesRoute(req: Request, run: (c: FilesCall) => Promise<Response>, opts: { path?: string | null } = {}): Promise<Response> {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const url = new URL(req.url)
  const name = url.pathname.split('/')[2]
  try {
    const sandbox = await getOwnedSandbox(p, name)
    const raw = opts.path !== undefined ? opts.path : url.searchParams.get('path')
    const path = raw === null || raw === '' ? null : safePath(raw)
    if (sandbox.status !== 'running') {
      return Response.json({ error: 'The sandbox is not running: wake it to use its files', reason: 'not_running' }, { status: 409 })
    }
    return await run({ name: sandbox.name, url, path })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const status = STATUS.find(([re]) => re.test(msg))?.[1] ?? 500
    if (status === 500) console.error(`[files] ${name}:`, err)
    return Response.json({ error: msg }, { status })
  }
}

/** A path the call must have (a removal or an upload never defaults to a folder). */
export function requirePath(c: FilesCall): string {
  if (!c.path) throw new Error('Give a path')
  return c.path
}

/** For a download's Content-Disposition: the name, ASCII-safe, and the UTF-8 one for browsers that read it. */
export function attachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_')
  return ascii === filename ? `attachment; filename="${filename}"` : `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
