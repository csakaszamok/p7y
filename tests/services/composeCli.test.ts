import { describe, it, expect } from 'vitest'
import { innerCliEnv, composeConfigCheck } from '../../services/compose'

describe('innerCliEnv', () => {
  // docker compose fills any ${VAR} it is not given from its own environment: a compose text
  // written by a user must not see Purgatory's secrets
  it("passes only what the compose CLI needs, never Purgatory's own settings", () => {
    const env = innerCliEnv({ PATH: '/bin', HOME: '/root', ADMIN_TOKEN: 'secret', SESSION_SECRET: 's', OIDC_CLIENT_SECRET: 'o', DOCKER_CONFIG: '/root/.docker' },
      { DOCKER_HOST: 'tcp://x:2376', DOCKER_TLS_VERIFY: '1', DOCKER_CERT_PATH: '/certs' })
    expect(env).toEqual({ PATH: '/bin', HOME: '/root', DOCKER_CONFIG: '/root/.docker', DOCKER_HOST: 'tcp://x:2376', DOCKER_TLS_VERIFY: '1', DOCKER_CERT_PATH: '/certs' })
  })
})

describe('composeConfigCheck', () => {
  it('gives up after its time limit instead of holding the create for ever', async () => {
    const started = Date.now()
    const problem = await composeConfigCheck('services: {}', { cwd: process.cwd(), timeoutMs: 300, command: [process.execPath, '-e', 'setTimeout(() => {}, 10000)'] })
    expect(problem).toBe('docker compose config took too long')
    expect(Date.now() - started).toBeLessThan(5000)
  })
})
