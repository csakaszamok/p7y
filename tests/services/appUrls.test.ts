import { describe, it, expect } from 'vitest'
import yaml from 'js-yaml'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { appHostsFromCompose, appHostsOffline, appEntriesFromCompose } from '../../services/appUrls'

const ctx = { instance: 'shop', project: 'inner', domain: 'lvh.me' }
const hosts = (services: Record<string, unknown>, c = ctx) => appHostsFromCompose(yaml.dump({ services }), c)

// The rules mirror the foxglove image's docker-gen template (/etc/frpc/frpc.tmpl):
// one HTTP proxy per published TCP port, named after frpc.subdomain when set.
describe('appHostsFromCompose', () => {
  it('matches what frps reports for the starter stack', () => {
    expect(hosts({
      portainer: { container_name: 'portainer', ports: ['9000:9000'], labels: { 'frpc.subdomain': 'portainer' } },
      'http-echo': { container_name: 'http-echo', ports: ['5678:5678'] }
    })).toEqual(['shop-portainer.lvh.me', 'shop-inner-http-echo-port5678.lvh.me'])
  })

  it('uses compose’s default container name <project>-<service>-1, lowercased, _ → -', () => {
    expect(hosts({ My_App: { ports: ['8080:80'] } })).toEqual(['shop-inner-inner-my-app-1-port8080.lvh.me'])
    expect(hosts({ web: { ports: ['8080:80'] } }, { ...ctx, project: 'My_Stack' })).toEqual(['shop-my-stack-my-stack-web-1-port8080.lvh.me'])
  })

  it('names the proxy by the host port; handles the long syntax and an all-interface IP', () => {
    expect(hosts({ web: { container_name: 'web', ports: ['0.0.0.0:8081:80', { target: 80, published: 8082 }, { target: 81, published: '8083', protocol: 'tcp' }, '[::]:8084:80'] } }))
      .toEqual(['shop-inner-web-port8081.lvh.me', 'shop-inner-web-port8082.lvh.me', 'shop-inner-web-port8083.lvh.me', 'shop-inner-web-port8084.lvh.me'])
  })

  // 127.0.0.1:port:port is private to the sandbox: no link (spec 2026-10-02-private-ports)
  it('gives no link to a port bound to a loopback or other specific address', () => {
    expect(hosts({ web: { container_name: 'web', ports: ['127.0.0.1:8081:80', '127.0.0.2:8085:80', '[::1]:8086:80', '10.0.0.5:8087:80', { target: 80, published: 8088, host_ip: '127.0.0.1' }] } })).toEqual([])
    expect(hosts({ app: { ports: ['127.0.0.1:80:80'], labels: { 'frpc.subdomain': 'app' } } })).toEqual([])
    // the unbracketed IPv6 spelling compose also accepts
    expect(hosts({ web: { container_name: 'web', ports: ['::1:6000:6000'] } })).toEqual([])
    expect(hosts({ web: { container_name: 'web', ports: [':::8090:80'] } })).toEqual(['shop-inner-web-port8090.lvh.me'])
    expect(hosts({ app: { ports: ['127.0.0.1:80:80', '443:443'], labels: { 'frpc.subdomain': 'app' } } })).toEqual(['shop-app.lvh.me'])
  })

  it('skips ports that are not published on a fixed TCP host port', () => {
    expect(hosts({ web: { container_name: 'web', ports: ['80', '8080:80/udp', '8000-8001:80-81', { target: 80 }, { target: 80, published: 9, protocol: 'udp' }], expose: ['3000'] } })).toEqual([])
    expect(hosts({ db: { image: 'postgres' } })).toEqual([])
  })

  it('lists a subdomain once however many ports it publishes; accepts list-form labels', () => {
    expect(hosts({ app: { ports: ['80:80', '443:443'], labels: ['frpc.subdomain=app'] } })).toEqual(['shop-app.lvh.me'])
  })

  it('returns nothing for an unreadable file', () => {
    expect(appHostsFromCompose(': not yaml : [', ctx)).toEqual([])
    expect(appHostsFromCompose('', ctx)).toEqual([])
  })
})

describe('appHostsOffline', () => {
  const setup = (files: Record<string, string>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ldr-apps-'))
    for (const [f, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(`${dir}/${f}`), { recursive: true })
      fs.writeFileSync(`${dir}/${f}`, text)
    }
    return dir
  }
  const inner = yaml.dump({ services: { 'http-echo': { container_name: 'http-echo', ports: ['5678:5678'] } } })

  it('reads the inner compose file, the instance name and the template’s inner project name', () => {
    const dir = setup({ 'inner/docker-compose.yml': inner, 'instance-name': 'shop\n' })
    expect(appHostsOffline('leander-shop', dir, 'lvh.me', () => 'stack')).toEqual(['shop-stack-http-echo-port5678.lvh.me'])
  })

  it('falls back to the name without leander- and the project "inner"', () => {
    const dir = setup({ 'inner/docker-compose.yml': inner })
    expect(appHostsOffline('leander-shop', dir, 'lvh.me', () => undefined)).toEqual(['shop-inner-http-echo-port5678.lvh.me'])
  })

  it('returns nothing without an inner compose file', () => {
    expect(appHostsOffline('leander-shop', setup({}), 'lvh.me', () => undefined)).toEqual([])
  })
})

describe('appHostsFromCompose with the built-in templates', () => {
  const hosts = (template: string) => appHostsFromCompose(yaml.dump(yaml.load(fs.readFileSync(path.join(process.cwd(), `templates/${template}/compose.yaml`), 'utf8'))).replace(/\$\{[a-z_]+\}/g, 'x'), ctx)
  it('gives the starter and portainer stacks their links (published on all interfaces)', () => {
    expect(hosts('starter')).toEqual(['shop-inner-http-echo-port5678.lvh.me'])
    expect(hosts('portainer')).toEqual(['shop-portainer.lvh.me', 'shop-inner-http-echo-port5678.lvh.me'])
  })
})

describe('appEntriesFromCompose', () => {
  it('gives each host its compose service', () => {
    expect(appEntriesFromCompose(yaml.dump({ services: {
      portainer: { container_name: 'portainer', ports: ['9000:9000'], labels: { 'frpc.subdomain': 'portainer' } },
      'http-echo': { container_name: 'http-echo', ports: ['5678:5678'] },
    } }), ctx)).toEqual([
      { host: 'shop-portainer.lvh.me', service: 'portainer' },
      { host: 'shop-inner-http-echo-port5678.lvh.me', service: 'http-echo' },
    ])
  })
})
