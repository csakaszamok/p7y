import fs from 'fs'
import os from 'os'
import yaml from 'js-yaml'
import { composeStop, composeStart, composeUpService } from './compose'
import { getSandboxState } from './docker'
import { entriesIn } from './sandboxPaths'

/**
 * Paths of the sandbox container kept in named volumes (sandbox_opt, …), next to docker_data. Without them a deep
 * sleep (compose down) or a removed container lost whatever was written there; the sandbox's inner Docker
 * (docker_data) always survived.
 */
export const DATA_PATHS = ['/opt', '/root', '/home', '/srv']
const volumeOf = (p: string) => `sandbox_${p.slice(1)}`

type Doc = { services?: Record<string, { volumes?: string[] } | undefined>; volumes?: Record<string, unknown> }

/** The compose file with the data volumes mounted on the sandbox and declared, or null if it needs no change. */
export function withDataVolumes(text: string): string | null {
  let doc: Doc | null
  try { doc = yaml.load(text) as Doc | null } catch { return null }
  const sb = doc?.services?.sandbox
  if (!sb) return null
  const mounts = sb.volumes ?? []
  const missing = DATA_PATHS.filter(p => !mounts.some(m => String(m).split(':')[1] === p))
  if (!missing.length) return null
  sb.volumes = [...mounts, ...missing.map(p => `${volumeOf(p)}:${p}`)]
  doc!.volumes = { ...(doc!.volumes ?? {}) }
  for (const p of missing) doc!.volumes[volumeOf(p)] = null
  return yaml.dump(doc, { lineWidth: -1 })
}

/** `du` binds: every volume of a sandbox under /d (disk usage). */
export function measureBinds(volumes: string[]): string[] {
  return volumes.map(v => `${v}:/d/${v}:ro`)
}

/**
 * Copies the container's current /opt, /root, /home, /srv into the sandbox's new data volumes (created with the
 * compose labels, so compose adopts them), through a helper container of our own image that is never started.
 */
async function copyIntoVolumes(name: string): Promise<void> {
  const { default: Dockerode } = await import('dockerode')
  const docker = new Dockerode({ socketPath: '/var/run/docker.sock' })
  for (const p of DATA_PATHS) {
    await docker.createVolume({ Name: `${name}_${volumeOf(p)}`, Labels: { 'com.docker.compose.project': name, 'com.docker.compose.volume': volumeOf(p) } })
  }
  const self = await docker.getContainer(os.hostname()).inspect()
  const helper = await docker.createContainer({
    Image: self.Image, Entrypoint: ['true'], Cmd: [], NetworkDisabled: true,
    HostConfig: { Binds: DATA_PATHS.map(p => `${name}_${volumeOf(p)}:${p}`) },
    Labels: { 'p7y.helper': 'data-volumes' },
  })
  try {
    const source = docker.getContainer(name)
    for (const p of DATA_PATHS) {
      let archive: NodeJS.ReadableStream
      try { archive = await source.getArchive({ path: p }) } catch { continue } // not in this image
      // The archive holds "opt/…": unpacked at / it lands in the volume mounted on /opt
      await helper.putArchive(archive, { path: '/' })
    }
  } finally {
    await helper.remove({ force: true }).catch(() => {})
  }
}

/**
 * Gives existing sandboxes the data volumes. A running one is stopped first (nothing written meanwhile), its files
 * copied, the compose file written and the sandbox container recreated and started; an asleep one is recreated
 * without starting; a deep-sleeping one has no container to copy from, so only its compose file changes.
 * On a failure the compose file stays as it was (the next start tries again) and a stopped one is started again.
 */
export async function migrateDataVolumes(usersDir?: string, deps: {
  status?: (name: string) => Promise<string | undefined>
  stop?: (composePath: string) => Promise<void>
  start?: (composePath: string) => Promise<void>
  copy?: (name: string) => Promise<void>
  recreate?: (composePath: string, start: boolean) => Promise<void>
  log?: (s: string) => void
} = {}): Promise<string[]> {
  const status = deps.status ?? (async (n: string) => (await getSandboxState(n))?.status)
  const stop = deps.stop ?? composeStop
  const start = deps.start ?? composeStart
  const copy = deps.copy ?? copyIntoVolumes
  const recreate = deps.recreate ?? ((f: string, s: boolean) => composeUpService(f, 'sandbox', s))
  const log = deps.log ?? (s => console.log(`[data-volumes] ${s}`))
  const migrated: string[] = []
  for (const { name, dir } of entriesIn(usersDir)) {
    const file = `${dir}/docker-compose.yml`
    let original: string
    try { original = fs.readFileSync(file, 'utf8') } catch { continue }
    const updated = withDataVolumes(original)
    if (!updated) continue
    const st = await status(name).catch(() => undefined)
    const running = st === 'running'
    try {
      if (running) await stop(file)
      if (st) await copy(name)
      fs.writeFileSync(file, updated)
      if (st) await recreate(file, running)
      migrated.push(name)
      log(`${name}: /opt, /root, /home and /srv now in volumes${st ? ' (files copied)' : ''}`)
    } catch (err) {
      fs.writeFileSync(file, original)
      if (running) await start(file).catch(() => {})
      log(`${name}: not migrated, tried again at the next start: ${err instanceof Error ? err.message : err}`)
    }
  }
  return migrated
}
