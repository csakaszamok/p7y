import { requirePrincipal } from '../../../services/principal'
import { getOwnedSandbox } from '../../../services/access'
import { sleepTimes } from '../../../services/sleepTimes'
import { publicTcpPorts, rememberedTcpPorts } from '../../../services/tcpNames'
import { sleepSettingsOf } from '../../../services/sleepSettings'
import { rawNameOf } from '../../../services/naming'
import { sshKeyCount, hasGeneratedKey } from '../../../services/sandboxSsh'
import { limitsOf } from '../../../services/resourceSettings'
import { usageOf } from '../../../services/usageSampler'
import { diskOf } from '../../../services/diskUsage'
import { appLinks } from '../../../services/appLinks'
import { appStatuses } from '../../../services/appProbe'
import { dockerAccessInfo } from '../../../services/dockerAccess'

export const openapi = {
  mcp: { name: 'get_sandbox' },
  summary: 'Get sandbox details',
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Sandbox record including TLS certs; apps: each link with answers true/false (null when not running)' },
    401: { description: 'Unauthorized' },
    404: { description: 'Sandbox not found' }
  }
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const name = new URL(req.url).pathname.split('/')[2]
  try {
    const sandbox = await getOwnedSandbox(p, name)
    // Whether each app answers (only a running sandbox is asked; never through Traefik/Sablier)
    const { app_services, ...info } = sandbox
    const apps = sandbox.status === 'running'
      ? await appStatuses(name, await appLinks(name))
      : sandbox.tunnel_urls.map(url => ({ url, port: null, service: app_services?.[url] ?? null, answers: null }))
    // Asleep: the ports it had when it last ran (a connection wakes it)
    const tcp = sandbox.status === 'running' ? await publicTcpPorts(name).catch(() => []) : rememberedTcpPorts(name) ?? []
    const tcp_urls = tcp.map(p => `${p.host}:443`)
    // port: the container's own port, so a client can tell Postgres from SSH (the name may not say)
    const tcp_addresses = tcp.map(p => ({ address: `${p.host}:443`, port: p.privatePort, ...(p.user ? { user: p.user } : {}) }))
    const domain = process.env.HOST_DOMAIN ?? 'lvh.me'
    const ssh = sandbox.ssh ? { address: `${rawNameOf(name) ?? name}-shell-tcp.${domain}:443`, user: 'root', keys: sshKeyCount(name), generated_key: hasGeneratedKey(name) } : null
    return Response.json({ ...info, ...(await sleepTimes(name)), idle_timeout: sleepSettingsOf(name).idle_timeout ?? null, tcp_urls, tcp_addresses, apps, ssh, docker_access: dockerAccessInfo(name, sandbox.status), limits: limitsOf(name), disk: diskOf(name), usage: sandbox.status === 'running' ? usageOf(name) : null })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'error'
    if (msg.includes('not found')) return Response.json({ error: msg }, { status: 404 })
    return Response.json({ error: msg }, { status: 500 })
  }
}
