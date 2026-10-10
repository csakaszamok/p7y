import { describe, it, expect } from 'vitest'
import { innerCliEnv, composeConfigCheck, composeUpInner } from '../../services/compose'

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

// The sandbox's dockerd starts about 1.5 s after its container: the first try right after compose up nearly always
// meets "Cannot connect", and a 3 s pause after it was most of the inner stack's time
describe('composeUpInner', () => {
  it('tries again every half second while the inner dockerd is starting, and says how many tries it took', async () => {
    let calls = 0
    const waits: number[] = []
    const tries = await composeUpInner('/x/docker-compose.yml', 'tcp://p7y-x:2376', '/certs', 'inner', {
      run: async () => { if (++calls < 3) throw new Error('Cannot connect to the Docker daemon at tcp://p7y-x:2376'); return { stderr: '' } },
      sleep: async ms => { waits.push(ms) },
    })
    expect(tries).toBe(3)
    expect(waits).toEqual([500, 500])
  })
  it('does not try again after another error', async () => {
    await expect(composeUpInner('/x/docker-compose.yml', 'tcp://p7y-x:2376', '/certs', 'inner', {
      run: async () => { throw new Error('services.web.ports must be a list') }, sleep: async () => {},
    })).rejects.toThrow('must be a list')
  })
})
