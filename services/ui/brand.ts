import fs from 'fs'
import path from 'path'
import { escapeHtml } from './layout'

/**
 * The name and logo the pages show, and whether the topbar links to GitHub:
 * UI_TITLE (default Purgatorium Agentium, none = no name), UI_LOGO (default the built-in one, none = no logo,
 * an http(s) address, or a file in the container such as /app/data/logo.png, served as /assets/custom-logo),
 * GITHUB_LINK=off (no GitHub card in the topbar).
 */

const DEFAULT_TITLE = 'Purgatorium Agentium'
export const BUILTIN_LOGO = '/assets/logo.svg'
export const CUSTOM_LOGO = '/assets/custom-logo'

const TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
}

const off = (v: string | undefined) => (v ?? '').trim().toLowerCase()

/** The name, null for none. */
export function brandTitle(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env.UI_TITLE?.trim()
  if (!v) return DEFAULT_TITLE
  return off(v) === 'none' ? null : v
}

/** The logo's address, null for none. */
export function brandLogo(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env.UI_LOGO?.trim()
  if (!v) return BUILTIN_LOGO
  if (off(v) === 'none') return null
  return /^https?:\/\//i.test(v) ? v : CUSTOM_LOGO
}

export function githubLinkEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return off(env.GITHUB_LINK) !== 'off'
}

/** UI_LOGO as a file: its bytes and type, null when it is not a readable image file. */
export function customLogoFile(env: NodeJS.ProcessEnv = process.env): { body: Uint8Array<ArrayBuffer>; type: string } | null {
  const v = env.UI_LOGO?.trim()
  if (!v || off(v) === 'none' || /^https?:\/\//i.test(v)) return null
  const type = TYPES[path.extname(v).toLowerCase()]
  if (!type) return null
  try { return { body: new Uint8Array(fs.readFileSync(v)), type } } catch { return null }
}

/** " — Purgatorium Agentium" after a page's own title, nothing without a name. */
export function titleSuffix(env: NodeJS.ProcessEnv = process.env): string {
  const t = brandTitle(env)
  return t ? ` — ${escapeHtml(t)}` : ''
}

export function faviconTag(env: NodeJS.ProcessEnv = process.env): string {
  const logo = brandLogo(env)
  if (!logo) return ''
  const type = logo === BUILTIN_LOGO ? ' type="image/svg+xml"' : ''
  return `<link rel="icon" href="${escapeHtml(logo)}"${type}>`
}

export function logoImg(size: number, cls = '', env: NodeJS.ProcessEnv = process.env): string {
  const logo = brandLogo(env)
  if (!logo) return ''
  // An own logo need not be square: only its height is set
  const width = logo === BUILTIN_LOGO ? ` width="${size}"` : ''
  return `<img${cls ? ` class="${cls}"` : ''} src="${escapeHtml(logo)}" alt=""${width} height="${size}">`
}
