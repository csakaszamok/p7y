import { describe, it, expect } from 'vitest'
import { frpcName, tcpPortsOf, type InnerContainer } from '../../services/tcpNames'

const c = (name: string, labels: Record<string, string>, ports: InnerContainer['Ports']): InnerContainer =>
  ({ Names: [`/${name}`], Labels: labels, Ports: ports })

describe('frpcName (same rules as foxglove frpc.tmpl)', () => {
  it('uses the frpc.subdomain label when set', () => {
    expect(frpcName('shop', { 'frpc.subdomain': 'db' }, 'pg', 5432)).toBe('shop-db')
  })
  it('uses stack and container name for compose containers', () => {
    expect(frpcName('shop', { 'com.docker.compose.project': 'My_App' }, 'My_App-db_1', 5432)).toBe('shop-my-app-my-app-db-1-port5432')
  })
  it('uses the container name alone otherwise', () => {
    expect(frpcName('shop', {}, 'Redis_Main', 6379)).toBe('shop-redis-main-port6379')
  })
})

describe('tcpPortsOf', () => {
  const inner = [
    c('db', { 'com.docker.compose.project': 'inner' }, [
      { IP: '0.0.0.0', PrivatePort: 5432, PublicPort: 5432, Type: 'tcp' },
      { IP: '::', PrivatePort: 5432, PublicPort: 5432, Type: 'tcp' },
    ]),
    c('portainer', { 'com.docker.compose.project': 'inner', 'frpc.subdomain': 'portainer' }, [
      { IP: '127.0.0.1', PrivatePort: 9000, PublicPort: 9000, Type: 'tcp' },
    ]),
    c('dns', {}, [{ IP: '0.0.0.0', PrivatePort: 53, PublicPort: 5353, Type: 'udp' }]),
    c('internal', {}, [{ PrivatePort: 8080, Type: 'tcp' }]),
    c('any', {}, [{ PrivatePort: 7000, PublicPort: 7000, Type: 'tcp' }]),
  ]

  it('gives each port of a frpc.subdomain container with several ports its own name', () => {
    const web = c('web', { 'frpc.subdomain': 'shop' }, [
      { IP: '0.0.0.0', PrivatePort: 8080, PublicPort: 8080, Type: 'tcp' },
      { IP: '0.0.0.0', PrivatePort: 5432, PublicPort: 5432, Type: 'tcp' },
    ])
    expect(tcpPortsOf('sb', [web], 'lvh.me')).toEqual([
      { host: 'sb-shop-port5432-tcp.lvh.me', port: 5432, privatePort: 5432 },
      { host: 'sb-shop-port8080-tcp.lvh.me', port: 8080, privatePort: 8080 },
    ])
    const one = c('web', { 'frpc.subdomain': 'shop' }, [{ IP: '0.0.0.0', PrivatePort: 5432, PublicPort: 5432, Type: 'tcp' }])
    expect(tcpPortsOf('sb', [one], 'lvh.me')).toEqual([{ host: 'sb-shop-tcp.lvh.me', port: 5432, privatePort: 5432 }])
  })

  it("never gives an inner container the sandbox's own SSH name (<sandbox>-shell-tcp)", () => {
    const shell = c('shell', { 'frpc.subdomain': 'shell' }, [{ IP: '0.0.0.0', PrivatePort: 22, PublicPort: 2200, Type: 'tcp' }])
    expect(tcpPortsOf('sb', [shell], 'lvh.me')).toEqual([])
  })

  it('lists only TCP ports published on all interfaces, once each, with the -tcp name', () => {
    expect(tcpPortsOf('shop', inner, 'lvh.me')).toEqual([
      { host: 'shop-inner-db-port5432-tcp.lvh.me', port: 5432, privatePort: 5432 },
      { host: 'shop-any-port7000-tcp.lvh.me', port: 7000, privatePort: 7000 },
    ])
  })

  it("gives the container's own port (what the service is) and the p7y.connect.user label", () => {
    const ssh = c('ssh', { 'frpc.subdomain': 'ssh', 'p7y.connect.user': 'demo' }, [{ IP: '0.0.0.0', PrivatePort: 22, PublicPort: 2022, Type: 'tcp' }])
    expect(tcpPortsOf('sb', [ssh], 'lvh.me')).toEqual([{ host: 'sb-ssh-tcp.lvh.me', port: 2022, privatePort: 22, user: 'demo' }])
  })
})
