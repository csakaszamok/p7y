// The volumes of the apps in a sandbox's own Docker, for the Files tab: their files are in the sandbox container,
// under docker_data (/var/lib/docker/volumes/<name>/_data), so the Files routes reach them like /root.
import { VOLUMES_DIR, volumeOf } from './sandboxFiles'

interface InnerVolume { Name: string; Driver: string; Labels: Record<string, string> | null }
interface InnerMount { Type: string; Name?: string; Source?: string; Destination: string }
interface InnerContainer { Names: string[]; State: string; Labels: Record<string, string> | null; Mounts: InnerMount[] }

export interface VolumeUser { name: string; service: string | null; running: boolean; mount: string }
export interface VolumeRow { name: string; path: string; project: string | null; containers: VolumeUser[] }

/** The local volumes (another driver keeps its files elsewhere), each with the containers that mount it. */
export function volumeRows(volumes: InnerVolume[], containers: InnerContainer[]): VolumeRow[] {
  return volumes
    .filter(v => v.Driver === 'local' && volumeOf(`${VOLUMES_DIR}/${v.Name}/_data`))
    .map(v => ({
      name: v.Name,
      path: `${VOLUMES_DIR}/${v.Name}/_data`,
      project: v.Labels?.['com.docker.compose.project'] ?? null,
      containers: containers.flatMap(c => c.Mounts.filter(m => m.Type === 'volume' && m.Name === v.Name).map(m => ({
        name: c.Names[0]?.replace(/^\//, '') ?? '',
        service: c.Labels?.['com.docker.compose.service'] ?? null,
        running: c.State === 'running',
        mount: m.Destination,
      }))),
    }))
    .sort((a, b) => (a.project ?? '').localeCompare(b.project ?? '') || a.name.localeCompare(b.name))
}

/** A running sandbox's volumes, asked of its own Docker. */
export async function sandboxVolumes(name: string): Promise<VolumeRow[]> {
  const docker = (await import('./innerDocker')).innerDocker(name)
  const [{ Volumes }, containers] = await Promise.all([docker.listVolumes(), docker.listContainers({ all: true })])
  return volumeRows((Volumes ?? []) as unknown as InnerVolume[], containers as unknown as InnerContainer[])
}
