import fs from 'fs'
import { sandboxName } from './naming'
import { sandboxParent } from './sandboxPaths'

/** The stored hash of a sandbox's registry password (user = its raw name; legacy leander-<raw> too), or null. */
export function registryHashOf(user: string, usersDir?: string): string | null {
  const file = [sandboxName(user), `leander-${user}`].map(n => `${usersDir ?? sandboxParent(n)}/${n}/registry.hash`).find(f => fs.existsSync(f))
  return file ? fs.readFileSync(file, 'utf8').trim() : null
}
