import fs from 'fs'
import { innerDocker } from './innerDocker'
import { sandboxParent } from './sandboxPaths'

export interface InnerContainer {
  Names: string[]
  Labels: Record<string, string>
  Ports: Array<{ IP?: string; PrivatePort: number; PublicPort?: number; Type: string }>
}
/** `port`: published in the sandbox (what the gateway connects to); `privatePort`: the container's own port,
 * i.e. which service it is; `user`: the `p7y.connect.user` label, the login the Connect… recipes use. */
export interface TcpPort { host: string; port: number; privatePort: number; user?: string }

const dash = (s: string) => s.toLowerCase().replace(/\//g, '-').replace(/_/g, '-')

/** The HTTP name frpc gives a published port (foxglove frpc.tmpl), without the domain. */
export function frpcName(instance: string, labels: Record<string, string>, containerName: string, hostPort: number): string {
  const subdomain = labels['frpc.subdomain']
  if (subdomain) return `${instance}-${subdomain}`
  const stack = (labels['com.docker.compose.project'] ?? '').toLowerCase().replace(/_/g, '-')
  const container = dash(containerName.replace(/^\//, ''))
  return stack ? `${instance}-${stack}-${container}-port${hostPort}` : `${instance}-${container}-port${hostPort}`
}

export const ALL_INTERFACES = new Set(['', '0.0.0.0', '::'])

/**
 * The -tcp names of the TCP ports published on all interfaces (127.0.0.1-published ports stay private).
 * A frpc.subdomain container has one HTTP name for all its ports; when it publishes several, each
 * gets `-port<N>` too, so a name never lands on another port than the one it says.
 */
export function tcpPortsOf(instance: string, containers: InnerContainer[], domain: string): TcpPort[] {
  const out: TcpPort[] = []
  const seen = new Set<string>()
  for (const ct of containers) {
    const published = ct.Ports.filter(p => p.Type === 'tcp' && p.PublicPort && ALL_INTERFACES.has(p.IP ?? ''))
    const ports = [...new Set(published.map(p => p.PublicPort!))].sort((a, b) => a - b)
    const user = ct.Labels['p7y.connect.user']
    const subdomain = ct.Labels['frpc.subdomain']
    for (const port of ports) {
      const base = subdomain && ports.length > 1
        ? `${instance}-${subdomain}-port${port}`
        : frpcName(instance, ct.Labels, ct.Names[0] ?? '', port)
      const host = `${base}-tcp.${domain}`
      if (host === `${instance}-shell-tcp.${domain}`) continue // the sandbox's own SSH address
      if (seen.has(host)) continue
      seen.add(host)
      const privatePort = published.find(p => p.PublicPort === port)!.PrivatePort
      out.push({ host, port, privatePort, ...(user ? { user } : {}) })
    }
  }
  return out
}

/** The sandbox's -tcp addresses, from its inner Docker (throws if that is not reachable, e.g. asleep). */
export async function publicTcpPorts(name: string, usersDir = sandboxParent(name)): Promise<TcpPort[]> {
  const dir = `${usersDir}/${name}`
  const instance = fs.readFileSync(`${dir}/instance-name`, 'utf8').trim()
  const inner = innerDocker(name, usersDir)
  const containers = await inner.listContainers() as unknown as InnerContainer[]
  return tcpPortsOf(instance, containers, (process.env.HOST_DOMAIN ?? 'lvh.me').toLowerCase())
}
