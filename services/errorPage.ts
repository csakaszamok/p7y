import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** Where Traefik's error-page middleware (traefik/errors.yml) asks for the 404 page, on the internal port. */
export const ERROR_PAGE_PATH = '/errors/404'

/** PUBLIC_URL for the page's portal link: only a plain address (nothing for HTML), else the page guesses p9m.<domain>. */
function portalUrl(env: NodeJS.ProcessEnv): string | null {
  const url = (env.PUBLIC_URL ?? '').replace(/\/+$/, '')
  return /^https?:\/\/[A-Za-z0-9.:-]+$/.test(url) ? url : null
}

/** The 404 page every route without a page of its own gets; read on each request, so a checkout's edit shows at once. */
export async function errorPage(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const html = await readFile(path.join(process.cwd(), 'error-pages', '404.html'), 'utf8')
  const url = portalUrl(env)
  return url ? html.replaceAll('{{P9M_URL}}', url) : html
}
