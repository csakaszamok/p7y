import { describe, it, expect } from 'vitest'
import { hubAppsOf } from '../../../services/hub/apps'
import type { InnerContainer } from '../../../services/tcpNames'

const c = (name: string, labels: Record<string, string>, ports: InnerContainer['Ports'] = []): InnerContainer =>
  ({ Names: [`/${name}`], Labels: { 'com.docker.compose.project': 'inner', 'com.docker.compose.service': name, ...labels }, Ports: ports })
const web = (port: number, ip = '0.0.0.0') => ({ IP: ip, PrivatePort: port, PublicPort: port, Type: 'tcp' })

describe('hubAppsOf', () => {
  it('publishes only containers labelled exactly "true", at their web address', () => {
    const { apps } = hubAppsOf('shop', [
      c('web', { 'p9m.publish': 'true', 'p9m.title': 'Stock room', 'p9m.description': 'Who took what' }, [web(8080)]),
      c('api', { 'p9m.publish': 'yes' }, [web(9000)]),
      c('db', {}, [web(5432)]),
    ], 'example.com', 'https')
    expect(apps).toEqual([{ id: 'shop-inner-web-port8080.example.com', url: 'https://shop-inner-web-port8080.example.com', title: 'Stock room', description: 'Who took what', service: 'web', port: 8080, image: null, access: 'public' }])
  })
  it('"1" publishes too (and "True", as YAML writers spell it); "yes", "0" and "false" do not', () => {
    const { apps } = hubAppsOf('shop', [
      c('one', { 'p9m.publish': '1' }, [web(8081)]),
      c('cap', { 'p9m.publish': 'True' }, [web(8082)]),
      c('yes', { 'p9m.publish': 'yes' }, [web(8083)]),
      c('zero', { 'p9m.publish': '0' }, [web(8084)]),
      c('no', { 'p9m.publish': 'false' }, [web(8085)]),
    ], 'example.com', 'https')
    expect(apps.map(a => a.service)).toEqual(['one', 'cap'])
  })
  it('an owner-only app is not published (listed apart, for a warning); domain and public are, with their level', () => {
    const r = hubAppsOf('shop', [
      c('web', { 'p9m.publish': 'true', 'p9m.access': 'domain' }, [web(8080)]),
      c('adm', { 'p9m.publish': 'true', 'p9m.access': 'owner' }, [web(8081)]),
      c('doc', { 'p9m.publish': 'true' }, [web(8082)]),
    ], 'example.com', 'https')
    expect(r.apps.map(a => [a.service, a.access])).toEqual([['web', 'domain'], ['doc', 'public']])
    expect(r.ownerOnly).toEqual(['adm'])
  })
  it('defaults the title to the service, uses p9m.subdomain, and the lowest port', () => {
    const { apps } = hubAppsOf('shop', [c('ui', { 'p9m.publish': 'true', 'p9m.subdomain': 'board' }, [web(9001), web(3000)])], 'example.com', 'http')
    expect(apps[0]).toMatchObject({ id: 'shop-board.example.com', url: 'http://shop-board.example.com', title: 'ui', description: '' })
  })
  it('uses p9m.subdomain', () => {
    const { apps } = hubAppsOf('shop', [
      c('ui', { 'p9m.publish': 'true', 'p9m.subdomain': 'board' }, [web(3000)]),
      c('api', { 'p9m.publish': 'true', 'p9m.subdomain': 'api' }, [web(3001)]),
    ], 'example.com', 'https')
    expect(apps.map(a => a.id)).toEqual(['shop-board.example.com', 'shop-api.example.com'])
  })
  it('cuts long titles and descriptions', () => {
    const { apps } = hubAppsOf('shop', [c('web', { 'p9m.publish': 'true', 'p9m.title': 't'.repeat(100), 'p9m.description': 'd'.repeat(400) }, [web(80)])], 'example.com', 'https')
    expect(apps[0].title).toHaveLength(80)
    expect(apps[0].description).toHaveLength(280)
  })
  it('lists a published container without a web address as unlinked', () => {
    const r = hubAppsOf('shop', [c('worker', { 'p9m.publish': 'true' }), c('admin', { 'p9m.publish': 'true' }, [web(8081, '127.0.0.1')])], 'example.com', 'https')
    expect(r.apps).toEqual([])
    expect(r.unlinked).toEqual(['worker', 'admin'])
  })
})

describe('hubAppsOf: only addresses under the domain', () => {
  it('drops an app whose p9m.subdomain is not a plain DNS label, so Open cannot point elsewhere', () => {
    const r = hubAppsOf('shop', [
      c('web', { 'p9m.publish': 'true', 'p9m.subdomain': 'x@evil.com/' }, [web(80)]),
      c('ok', { 'p9m.publish': 'true', 'p9m.subdomain': 'board' }, [web(81)]),
    ], 'example.com', 'https')
    expect(r.apps.map(a => a.url)).toEqual(['https://shop-board.example.com'])
    expect(r.unlinked).toEqual(['web'])
    const p = hubAppsOf('shop', [c('web', { 'p9m.publish': 'true', 'p9m.subdomain': 'x@evil.com/' }, [web(80)])], 'example.com', 'https')
    expect(p.apps).toEqual([])
    expect(p.unlinked).toEqual(['web'])
  })
})

describe('hubAppsOf: the image label', () => {
  it('keeps a path inside the app, and nothing else', () => {
    const r = hubAppsOf('shop', [
      c('a', { 'p9m.publish': 'true', 'p9m.image': '/img/shot.png' }, [web(81)]),
      c('b', { 'p9m.publish': 'true', 'p9m.image': 'https://evil.example/x.png' }, [web(82)]),
      c('c', { 'p9m.publish': 'true', 'p9m.image': '//evil.example/x.png' }, [web(83)]),
    ], 'example.com', 'https')
    expect(r.apps.map(a => a.image)).toEqual(['/img/shot.png', null, null])
  })
})

describe('hubAppsOf: an unusable image label', () => {
  it('names the services whose p9m.image is not a path inside the app', () => {
    const r = hubAppsOf('shop', [
      c('a', { 'p9m.publish': 'true', 'p9m.image': 'https://picsum.photos/200' }, [web(81)]),
      c('b', { 'p9m.publish': 'true', 'p9m.image': '/ok.png' }, [web(82)]),
      c('d', { 'p9m.publish': 'true' }, [web(83)]),
    ], 'example.com', 'https')
    expect(r.badImage).toEqual(['a'])
  })
})
