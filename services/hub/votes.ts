import fs from 'node:fs'
import { writeFileAtomic } from '../atomicWrite'

/** Who voted for which app (app id → voters' e-mails). Nothing deletes votes automatically. */
export const votesFile = () => process.env.HUB_VOTES_FILE ?? '/app/data/hub-votes.json'

function read(file: string): Record<string, string[]> {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string[]> } catch { return {} }
}

export function voteCounts(file = votesFile()): Record<string, number> {
  return Object.fromEntries(Object.entries(read(file)).filter(([, v]) => v.length).map(([k, v]) => [k, v.length]))
}

export function votedBy(user: string, file = votesFile()): Set<string> {
  const u = user.toLowerCase()
  return new Set(Object.entries(read(file)).filter(([, v]) => v.includes(u)).map(([k]) => k))
}

export function addVote(appId: string, user: string, file = votesFile()): void {
  const all = read(file)
  const u = user.toLowerCase()
  const voters = all[appId] ?? []
  if (voters.includes(u)) return
  all[appId] = [...voters, u]
  writeFileAtomic(file, JSON.stringify(all))
}

export function removeVote(appId: string, user: string, file = votesFile()): void {
  const all = read(file)
  const u = user.toLowerCase()
  if (!all[appId]?.includes(u)) return
  all[appId] = all[appId].filter(v => v !== u)
  writeFileAtomic(file, JSON.stringify(all))
}
