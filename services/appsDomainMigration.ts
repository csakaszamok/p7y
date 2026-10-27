import fs from 'fs'
import { composeCreate, composeUp } from './compose'
import { getSandboxState } from './docker'
import { appsDomain } from './domains'
import { rawNameOf } from './naming'
import { entriesIn, listSandboxDirs } from './sandboxPaths'

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The domain the sandbox's router answers under (the runtime's HostRegexp(`^<raw>-[a-z0-9-]+[.]<domain>$`)), or null. */
export function routedDomain(text: string, rawName: string): string | null {
  const m = text.match(new RegExp(`HostRegexp\\(\`\\^${escapeRegExp(rawName)}-\\[a-z0-9-\\]\\+\\[\\.\\](.+?)\\$\`\\)`))
  return m ? m[1] : null
}

/** The compose file with its router and the sandbox's BASE_DOMAIN (what frpc names the apps with) under `to`. */
export function withAppsDomain(text: string, rawName: string, from: string, to: string): string {
  const rule = `HostRegexp(\`^${rawName}-[a-z0-9-]+[.]${from}$\`)`
  const base = new RegExp(`^(\\s*BASE_DOMAIN:\\s*)(["']?)${escapeRegExp(from)}\\2\\s*$`)
  return text.split('\n').map(line => {
    const cr = line.endsWith('\r') ? '\r' : ''
    const l = cr ? line.slice(0, -1) : line
    if (l.includes(rule)) return l.split(rule).join(`HostRegexp(\`^${rawName}-[a-z0-9-]+[.]${to}$\`)`) + cr
    const m = l.match(base)
    return m ? `${m[1]}${m[2]}${to}${m[2]}${cr}` : line
  }).join('\n')
}

/** The sandbox's addresses (`<raw>-….<from>`) in a remembered list (lastSeen) under `to`; anything else as it is. */
export function withRememberedHosts(text: string, rawName: string, from: string, to: string): string {
  return text.replace(new RegExp(`(?<![a-z0-9.-])(${escapeRegExp(rawName)}-[a-z0-9-]+)\\.${escapeRegExp(from)}(?![a-z0-9.-])`, 'g'), `$1.${to}`)
}
// What the sandbox showed when it last ran (lastSeen.ts), shown while it sleeps
const REMEMBERED = ['apps', 'tcp', 'hub']

/**
 * A sandbox's compose file holds its app domain (the router's HostRegexp, BASE_DOMAIN), so a new APPS_DOMAIN would
 * leave the sandboxes made before answering only under the old one. Rewrites both to the current apps domain and
 * recreates the sandbox's containers: started if it was running or its last start failed, otherwise left stopped
 * (asleep); a deep-sleeping one only gets the file rewritten. Its old addresses redirect (routes/wake). Returns the
 * migrated sandbox names.
 */
export async function migrateAppsDomain(flatDir?: string, to = appsDomain()): Promise<string[]> {
  const entries = flatDir === undefined ? listSandboxDirs() : entriesIn(flatDir)
  const migrated: string[] = []
  for (const { name, dir } of entries) {
    const raw = rawNameOf(name)
    if (!raw) continue
    const composePath = `${dir}/docker-compose.yml`
    let original: string
    try { original = fs.readFileSync(composePath, 'utf8') } catch { continue }
    const from = routedDomain(original, raw)
    if (!from || from === to) continue
    try {
      fs.writeFileSync(composePath, withAppsDomain(original, raw, from, to))
      for (const what of REMEMBERED) {
        const file = `${dir}/${what}.json`
        try { fs.writeFileSync(file, withRememberedHosts(fs.readFileSync(file, 'utf8'), raw, from, to)) } catch { /* not remembered */ }
      }
      const state = await getSandboxState(name)
      if (state) {
        if (state.status === 'running' || state.error) await composeUp(composePath)
        else await composeCreate(composePath)
      }
      migrated.push(name)
      console.log(`[apps-domain] ${name}: apps moved from ${from} to ${to}`)
    } catch (err) {
      fs.writeFileSync(composePath, original) // retried on the next start
      console.error(`[apps-domain] ${name} failed:`, err instanceof Error ? err.message : err)
    }
  }
  return migrated
}
