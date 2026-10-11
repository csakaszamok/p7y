import { describe, it, expect, vi } from 'vitest'
import { appReady, type AppReadyDeps } from '../../services/appReady'

const redmine = { url: 'shop-redmine.lvh.me', port: 3000, service: 'redmine' }
const portainer = { url: 'shop-portainer.lvh.me', port: 9000, service: 'portainer' }

function deps(over: Partial<AppReadyDeps> = {}): AppReadyDeps {
  return {
    find: host => host.startsWith('shop-') ? 'p7y-shop' : null,
    running: async () => true,
    links: async () => [redmine, portainer],
    remembered: () => [redmine, portainer],
    probe: vi.fn(async (_name: string, port: number) => port === 9000),
    ...over,
  }
}

describe('appReady: whether the app behind an address answers yet (the waiting page asks before opening it)', () => {
  it('its port answers: ready, probed on the sandbox container', async () => {
    const d = deps()
    expect(await appReady('shop-portainer.lvh.me', d)).toEqual({ ready: true, service: 'portainer' })
    expect(d.probe).toHaveBeenCalledWith('p7y-shop', 9000)
  })
  it('its tunnel is up but the app does not answer yet (frps would say 404): not ready', async () => {
    expect(await appReady('shop-redmine.lvh.me', deps())).toEqual({ ready: false, service: 'redmine' })
  })
  it('a port in the host header and capitals make no difference', async () => {
    expect(await appReady('Shop-Portainer.lvh.me:443', deps())).toEqual({ ready: true, service: 'portainer' })
  })
  it('an app the sandbox had before, not registered again yet, or a sandbox still starting: not ready', async () => {
    expect(await appReady('shop-redmine.lvh.me', deps({ links: async () => [portainer] }))).toEqual({ ready: false, service: 'redmine' })
    expect(await appReady('shop-redmine.lvh.me', deps({ running: async () => false }))).toEqual({ ready: false, service: 'redmine' })
  })
  it('no sandbox, or an address no app of it ever had: not known (the page opens it as before)', async () => {
    expect(await appReady('nope.lvh.me', deps())).toEqual({ ready: null })
    expect(await appReady('shop-typo.lvh.me', deps({ remembered: () => null }))).toEqual({ ready: null })
  })
})
