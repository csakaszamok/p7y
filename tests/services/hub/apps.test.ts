import { describe, it, expect } from 'vitest'
import { hubAppsOf } from '../../../services/hub/apps'
import type { InnerContainer } from '../../../services/tcpNames'

const c = (name: string, labels: Record<string, string>, ports: InnerContainer['Ports'] = []): InnerContainer =>
  ({ Names: [`/${name}`], Labels: { 'com.docker.compose.project': 'inner', 'com.docker.compose.service': name, ...labels }, Ports: ports })
const web = (port: number, ip = '0.0.0.0') => ({ IP: ip, PrivatePort: port, PublicPort: port, Type: 'tcp' })

describe('hubAppsOf', () => {
  it('publishes only containers labelled exactly "true", at their web address', () => {
    const { apps } = hubAppsOf('shop', [
      c('web', { 'p7y.publish': 'true', 'p7y.title': 'Stock room', 'p7y.description': 'Who took what' }, [web(8080)]),
      c('api', { 'p7y.publish': 'yes' }, [web(9000)]),
      c('db', {}, [web(5432)]),
    ], 'example.com', 'https')
    expect(apps).toEqual([{ id: 'shop-inner-web-port8080.example.com', url: 'https://shop-inner-web-port8080.example.com', title: 'Stock room', description: 'Who took what', service: 'web' }])
  })
  it('defaults the title to the service, uses frpc.subdomain, and the lowest port', () => {
    const { apps } = hubAppsOf('shop', [c('ui', { 'p7y.publish': 'true', 'frpc.subdomain': 'board' }, [web(9001), web(3000)])], 'example.com', 'http')
    expect(apps[0]).toMatchObject({ id: 'shop-board.example.com', url: 'http://shop-board.example.com', title: 'ui', description: '' })
  })
  it('cuts long titles and descriptions', () => {
    const { apps } = hubAppsOf('shop', [c('web', { 'p7y.publish': 'true', 'p7y.title': 't'.repeat(100), 'p7y.description': 'd'.repeat(400) }, [web(80)])], 'example.com', 'https')
    expect(apps[0].title).toHaveLength(80)
    expect(apps[0].description).toHaveLength(280)
  })
  it('lists a published container without a web address as unlinked', () => {
    const r = hubAppsOf('shop', [c('worker', { 'p7y.publish': 'true' }), c('admin', { 'p7y.publish': 'true' }, [web(8081, '127.0.0.1')])], 'example.com', 'https')
    expect(r.apps).toEqual([])
    expect(r.unlinked).toEqual(['worker', 'admin'])
  })
})

describe('hubAppsOf: only addresses under the domain', () => {
  it('drops an app whose frpc.subdomain is not a plain DNS label, so Open cannot point elsewhere', () => {
    const r = hubAppsOf('shop', [
      c('web', { 'p7y.publish': 'true', 'frpc.subdomain': 'x@evil.com/' }, [web(80)]),
      c('ok', { 'p7y.publish': 'true', 'frpc.subdomain': 'board' }, [web(81)]),
    ], 'example.com', 'https')
    expect(r.apps.map(a => a.url)).toEqual(['https://shop-board.example.com'])
    expect(r.unlinked).toEqual(['web'])
  })
})
