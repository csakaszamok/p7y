import { describe, it, expect } from 'vitest'
import { internalOnly, INTERNAL_PORT } from '../../../services/appAccess/internal'

describe('internal-only paths', () => {
  it('the forwardAuth and the HTTP provider answer only on the internal port', () => {
    expect(INTERNAL_PORT).toBe(3001)
    for (const p of ['/auth/app', '/traefik/access', '/errors/404']) expect(internalOnly(p)).toBe(true)
    // The sign-in step is on Purgatorium's own host, for browsers
    for (const p of ['/auth/app/start', '/auth/callback', '/sandboxes', '/']) expect(internalOnly(p)).toBe(false)
  })
})
