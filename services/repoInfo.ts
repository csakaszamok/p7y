import fs from 'fs'

/**
 * What the topbar shows about Purgatory itself: its GitHub repo, version, stars and forks.
 * The counts are fetched by the server (never the users' browsers), at most once an hour, and kept in memory;
 * GITHUB_STATS=off never asks GitHub (the link and the version stay).
 */

export const REPO = 'csakaszamok/p7y'
const TTL = 60 * 60_000
const RETRY = 10 * 60_000

export interface RepoInfo { repo: string; url: string; version: string | null; stars: number | null; forks: number | null }

let version: string | null | undefined
let stats: { stars: number; forks: number } | null = null
let fetchedAt = 0
let pending: Promise<void> | null = null

function readVersion(): string | null {
  // The image's /app/package.json is its base's: Purgatory's own is copied next to it
  try { return (JSON.parse(fs.readFileSync(process.env.P7Y_PACKAGE_JSON ?? '/app/p7y/package.json', 'utf8')) as { version?: string }).version ?? null } catch { return null }
}

export function statsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.GITHUB_STATS ?? '').trim().toLowerCase() !== 'off'
}

async function refresh(): Promise<void> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'p7y' }, signal: AbortSignal.timeout(5_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const d = await res.json() as { stargazers_count?: unknown; forks_count?: unknown }
    if (typeof d.stargazers_count !== 'number' || typeof d.forks_count !== 'number') throw new Error('unexpected answer')
    stats = { stars: d.stargazers_count, forks: d.forks_count }
    fetchedAt = Date.now()
  } catch (err) {
    // Keep the last counts; ask again sooner than the hour
    fetchedAt = Date.now() - TTL + RETRY
    console.warn(`[github] cannot fetch the star and fork counts: ${err instanceof Error ? err.message : err}`)
  }
}

/** The counts as last fetched (null before the first answer); starts a refresh in the background when stale. */
export function repoInfo(now = Date.now()): RepoInfo {
  if (version === undefined) version = readVersion()
  if (statsEnabled() && !pending && now - fetchedAt >= TTL) pending = refresh().finally(() => { pending = null })
  return { repo: REPO, url: `https://github.com/${REPO}`, version, stars: stats?.stars ?? null, forks: stats?.forks ?? null }
}

/** Tests: wait for a refresh in flight. */
export function _settled(): Promise<void> { return pending ?? Promise.resolve() }

/** Tests: forget the version and the counts. */
export function _resetRepoInfo(): void {
  version = undefined; stats = null; fetchedAt = 0; pending = null
}
