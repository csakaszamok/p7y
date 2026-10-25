import fs from 'fs'
import { sandboxName } from './naming'
import { sandboxParent } from './sandboxPaths'

/** The stored hash of a sandbox's registry password (user = its raw name), or null. */
export function registryHashOf(user: string, usersDir?: string): string | null {
  const n = sandboxName(user)
  const file = `${usersDir ?? sandboxParent(n)}/${n}/registry.hash`
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null
}
