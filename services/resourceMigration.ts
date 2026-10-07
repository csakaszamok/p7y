import fs from 'fs'
import path from 'path'
import { readLimits, withLimits, resourceDefaults, formatBytes, clampToHost, type Limits } from './resources'
import { updateResources, getSandboxState, containerStats, hostResources } from './docker'
import { usageFromStats } from './usageSampler'
import { entriesIn } from './sandboxPaths'

/** Sandboxes created before limits existed get the default: in the compose file, and live where it fits. */
export async function migrateResourceLimits(deps: {
  usersDir?: string; defaults?: Limits; update?: (n: string, l: Limits) => Promise<void>; log?: (s: string) => void
  state?: (n: string) => Promise<string | undefined>; memoryInUse?: (n: string) => Promise<number | null>
} = {}): Promise<void> {
  const defaults = deps.defaults ?? clampToHost(resourceDefaults().limits, await hostResources())
  const update = deps.update ?? updateResources
  const log = deps.log ?? (s => console.log(`[resources] ${s}`))
  const state = deps.state ?? (async n => (await getSandboxState(n))?.status)
  const memoryInUse = deps.memoryInUse ?? (async n => usageFromStats(await containerStats(n))?.memory ?? null)
  for (const { name, dir } of entriesIn(deps.usersDir)) {
    const file = path.join(dir, 'docker-compose.yml')
    if (!fs.existsSync(file)) continue
    try {
      const text = fs.readFileSync(file, 'utf8')
      if (readLimits(text)) continue
      const st = await state(name).catch(() => undefined)
      if (!st) { fs.writeFileSync(file, withLimits(text, defaults)); continue } // deep sleep: the compose file is enough
      const used = st === 'running' ? await memoryInUse(name).catch(() => null) : null
      if (used !== null && used > defaults.memory) {
        // Left without a limit (and shown so), not given one it does not have: tried again at the next start
        log(`${name}: uses ${formatBytes(used)}, more than the default ${formatBytes(defaults.memory)}: left unlimited for now, tried again at the next start`)
        continue
      }
      await update(name, defaults)
      fs.writeFileSync(file, withLimits(text, defaults))
      log(`${name}: limited to ${defaults.cpus} CPUs and ${formatBytes(defaults.memory)}`)
    } catch (err) { log(`${name}: ${err instanceof Error ? err.message : err}`) }
  }
}
