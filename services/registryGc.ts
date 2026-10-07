import fs from 'fs'
import Dockerode from 'dockerode'

const WEEK = 7 * 24 * 3600_000
const stateFile = () => process.env.REGISTRY_GC_FILE ?? '/app/data/registry-gc.json'

/** Whether a week has passed since the last garbage collection (none yet: due). */
export function gcDue(lastRun: string | null, now = Date.now()): boolean {
  return !lastRun || now - Date.parse(lastRun) > WEEK
}

/**
 * Frees the space of deleted versions: `registry garbage-collect` in the registry container, once a week (checked
 * hourly, remembered across restarts), detached. A push running at that moment may fail and must be retried.
 */
export function startRegistryGc(): void {
  const docker = new Dockerode({ socketPath: '/var/run/docker.sock' })
  const check = async () => {
    let last: string | null = null
    try { last = (JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as { last_run?: string }).last_run ?? null } catch { /* never ran */ }
    if (!gcDue(last)) return
    try {
      const [c] = await docker.listContainers({ filters: { label: ['com.docker.compose.service=registry'] } })
      if (!c) return
      const exec = await docker.getContainer(c.Id).exec({ Cmd: ['registry', 'garbage-collect', '--delete-untagged', '/etc/docker/registry/config.yml'] })
      await exec.start({ Detach: true })
      fs.writeFileSync(stateFile(), JSON.stringify({ last_run: new Date().toISOString() }))
      console.log('[registry] garbage collection started')
    } catch (err) { console.error('[registry] garbage collection failed:', err instanceof Error ? err.message : err) }
  }
  setInterval(() => { void check() }, 3600_000).unref()
}
