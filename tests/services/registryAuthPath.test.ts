import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// CI runs on Linux, where /app/data is not writable: the key pair must go where REGISTRY_AUTH_DIR says
describe('registry auth key pair location', () => {
  it('is written to REGISTRY_AUTH_DIR', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-regauth-'))
    vi.stubEnv('REGISTRY_AUTH_DIR', dir)
    vi.resetModules()
    const { ensureKeyPair } = await import('../../services/registryAuth')
    ensureKeyPair()
    expect(fs.existsSync(path.join(dir, 'registry-auth.key'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'registry-auth.crt'))).toBe(true)
  })
})
