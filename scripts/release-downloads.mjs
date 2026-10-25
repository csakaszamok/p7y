#!/usr/bin/env node
// How often each release's files were downloaded from GitHub: an installation fetches docker-compose.yml and
// setup.sh from releases/latest/download, so their counts are about the installations and upgrades.
// GitHub keeps only the totals, not who or where. No dependencies; GITHUB_TOKEN raises the API's rate limit.
//
//   node scripts/release-downloads.mjs [owner/repo]
const repo = process.argv[2] ?? 'csakaszamok/p9m'
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'p9m-release-downloads' }
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

const releases = []
for (let page = 1; ; page++) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, { headers })
  if (!res.ok) { console.error(`GitHub: HTTP ${res.status} ${await res.text()}`); process.exit(1) }
  const batch = await res.json()
  releases.push(...batch)
  if (batch.length < 100) break
}

const names = [...new Set(releases.flatMap(r => r.assets.map(a => a.name)))].sort()
const rows = releases.map(r => {
  const count = Object.fromEntries(r.assets.map(a => [a.name, a.download_count]))
  return [r.tag_name, (r.published_at ?? '').slice(0, 10), ...names.map(n => count[n] ?? 0), r.assets.reduce((s, a) => s + a.download_count, 0)]
})
const head = ['release', 'published', ...names, 'total']
const total = ['total', '', ...names.map((_, i) => rows.reduce((s, r) => s + r[i + 2], 0)), rows.reduce((s, r) => s + r.at(-1), 0)]
const table = [head, ...rows, total].map(r => r.map(String))
const width = head.map((_, i) => Math.max(...table.map(r => r[i].length)))
for (const r of table) console.log(r.map((c, i) => i < 2 ? c.padEnd(width[i]) : c.padStart(width[i])).join('  '))
