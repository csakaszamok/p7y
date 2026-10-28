import { describe, it, expect } from 'vitest'
import { internalOnly, internalListenAddress, INTERNAL_PORT } from '../../../services/appAccess/internal'

describe('internal-only paths', () => {
  it('the forwardAuth and the HTTP provider answer only on the internal port', () => {
    expect(INTERNAL_PORT).toBe(3001)
    for (const p of ['/auth/app', '/traefik/access', '/errors/404']) expect(internalOnly(p)).toBe(true)
    // The sign-in step is on Purgatorium's own host, for browsers
    for (const p of ['/auth/app/start', '/auth/callback', '/sandboxes', '/']) expect(internalOnly(p)).toBe(false)
  })
})

// Purgatorium is on traefik-net with the sandboxes: on every address, any of them could ask the internal port
describe('internalListenAddress', () => {
  it("is Purgatorium's address on the internal network only Traefik shares", async () => {
    const inspect = async () => ({ NetworkSettings: { Networks: { 'traefik-net': { IPAddress: '172.18.0.5' }, 'sablier-net': { IPAddress: '172.19.0.3' } } } })
    expect(await internalListenAddress(inspect)).toBe('172.19.0.3')
  })
  it('is null without that network, or outside Docker', async () => {
    expect(await internalListenAddress(async () => ({ NetworkSettings: { Networks: { 'traefik-net': { IPAddress: '172.18.0.5' } } } }))).toBeNull()
    expect(await internalListenAddress(async () => { throw new Error('no docker') })).toBeNull()
  })
})
