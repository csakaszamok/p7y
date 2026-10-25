import fs from 'fs'

/**
 * What the topbar shows about Purgatorium itself: its GitHub repo, version, stars, forks and newer releases.
 * The counts and the releases are fetched by the server (never the users' browsers), at most once an hour, and kept
 * in memory; GITHUB_STATS=off never asks GitHub (the link and the version stay).
 */

export const REPO = 'csakaszamok/p9m'
const TTL = 60 * 60_000
const RETRY = 10 * 60_000

/** Newer releases than the running one: the newest of its own series (a pull away) and the newest of a later series. */
export interface Updates { patch: string | null; next: string | null }
export interface RepoInfo { repo: string; url: string; version: string | null; stars: number | null; forks: number | null; updates: Updates }

const NO_UPDATES: Updates = { patch: null, next: null }

let version: string | null | undefined
let stats: { stars: number; forks: number } | null = null
let releases: unknown = null
let fetchedAt = 0
let pending: Promise<void> | null = null

function readVersion(): string | null {
  // The image's /app/package.json is its base's: Purgatorium's own is copied next to it
  try { return (JSON.parse(fs.readFileSync(process.env.P9M_PACKAGE_JSON ?? '/app/p9m/package.json', 'utf8')) as { version?: string }).version ?? null } catch { return null }
}

export function statsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.GITHUB_STATS ?? '').trim().toLowerCase() !== 'off'
}

const parse = (v: string): [number, number, number] | null => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
const cmp = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** From GitHub's list of releases (drafts, pre-releases and other tags left out): what is newer than `current`. */
export function newerReleases(current: string | null, list: unknown): Updates {
  const cur = current ? parse(current) : null
  if (!cur || !Array.isArray(list)) return NO_UPDATES
  let patch: number[] | null = null, next: number[] | null = null
  for (const r of list as { tag_name?: unknown; draft?: unknown; prerelease?: unknown }[]) {
    if (r.draft || r.prerelease || typeof r.tag_name !== 'string') continue
    const v = parse(r.tag_name)
    if (!v || cmp(v, cur) <= 0) continue
    if (v[0] === cur[0] && v[1] === cur[1]) { if (!patch || cmp(v, patch) > 0) patch = v }
    else if (!next || cmp(v, next) > 0) next = v
  }
  return { patch: patch?.join('.') ?? null, next: next?.join('.') ?? null }
}

async function github(path: string): Promise<unknown> {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'p9m' }, signal: AbortSignal.timeout(5_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function refresh(): Promise<void> {
  try {
    const [d, list] = await Promise.all([github('') as Promise<{ stargazers_count?: unknown; forks_count?: unknown }>, github('/releases?per_page=100')])
    if (typeof d.stargazers_count !== 'number' || typeof d.forks_count !== 'number' || !Array.isArray(list)) throw new Error('unexpected answer')
    stats = { stars: d.stargazers_count, forks: d.forks_count }
    releases = list
    fetchedAt = Date.now()
  } catch (err) {
    // Keep the last counts and releases; ask again sooner than the hour
    fetchedAt = Date.now() - TTL + RETRY
    console.warn(`[github] cannot fetch the star and fork counts or the releases: ${err instanceof Error ? err.message : err}`)
  }
}

/** Purgatorium's own version (its package.json), null if unknown: the topbar and the OpenAPI document. */
export function p9mVersion(): string | null {
  if (version === undefined) version = readVersion()
  return version
}

/** The counts and newer releases as last fetched (none before the first answer); starts a refresh in the background when stale. */
export function repoInfo(now = Date.now()): RepoInfo {
  if (version === undefined) version = readVersion()
  if (statsEnabled() && !pending && now - fetchedAt >= TTL) pending = refresh().finally(() => { pending = null })
  return { repo: REPO, url: `https://github.com/${REPO}`, version, stars: stats?.stars ?? null, forks: stats?.forks ?? null, updates: newerReleases(version, releases) }
}

/** Tests: wait for a refresh in flight. */
export function _settled(): Promise<void> { return pending ?? Promise.resolve() }

/** Tests: forget the version and the counts. */
export function _resetRepoInfo(): void {
  version = undefined; stats = null; releases = null; fetchedAt = 0; pending = null
}
