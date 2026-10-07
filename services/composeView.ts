import fs from 'fs'
import { sandboxParent } from './sandboxPaths'

const MASK = '•••'
const SECRET_NAME = '[A-Za-z0-9_.-]*(?:token|password|passwd|secret|key)[A-Za-z0-9_.-]*'
// "FRP_TOKEN: value" (a map entry, also as a "- " list item)
const MAP_ENTRY = new RegExp(`^(\\s*(?:-\\s+)?)(${SECRET_NAME})(\\s*:\\s+)(\\S.*)$`, 'gim')
// "- API_KEY=value" (environment as a list)
const LIST_ENV = new RegExp(`^(\\s*-\\s+["']?)(${SECRET_NAME})=([^"'\\n]+)(["']?)$`, 'gim')
// bcrypt hashes, also escaped for compose ($$2b$$10$$…)
const BCRYPT = /\$\$?2[aby]\$\$?\d{2}\$\$?[./A-Za-z0-9]{53}/g

/** The compose text with every secret value replaced by •••; everything else unchanged. */
export function maskSecrets(text: string): string {
  return text
    .replace(BCRYPT, MASK)
    .replace(MAP_ENTRY, (_m, lead, key, sep) => `${lead}${key}${sep}${MASK}`)
    .replace(LIST_ENV, (_m, lead, key, _v, quote) => `${lead}${key}=${MASK}${quote}`)
}

/** The starter stack Purgatory deployed into the sandbox, secrets masked; null if it has none. */
export function starterStack(name: string, usersDir = sandboxParent(name)): string | null {
  if (!fs.existsSync(`${usersDir}/${name}/docker-compose.yml`)) throw new Error(`Sandbox not found: ${name}`)
  const inner = `${usersDir}/${name}/inner/docker-compose.yml`
  return fs.existsSync(inner) ? maskSecrets(fs.readFileSync(inner, 'utf8')) : null
}
