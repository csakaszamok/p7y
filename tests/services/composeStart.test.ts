import { describe, it, expect, vi } from 'vitest'
import { composeStart } from '../../services/compose'

const SYSBOX = 'Error response from daemon: failed to create task for container: failed to create shim task: OCI runtime create failed: failed to pre-register with sysbox-fs: failed to pre-register container with sysbox-fs: rpc error: code = AlreadyExists desc = Container 2bdf already pre-registered: unknown'

describe('composeStart', () => {
  it('starts the stopped containers', async () => {
    const exec = vi.fn(async () => {})
    await composeStart('/s/p7y-a/docker-compose.yml', exec)
    expect(exec.mock.calls).toEqual([['docker compose -f "/s/p7y-a/docker-compose.yml" start']])
  })

  // sysbox refuses that container for good after one failed start: a wake would fail every time
  it('recreates the containers when sysbox refuses to start them again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const exec = vi.fn(async (cmd: string) => { if (cmd.endsWith(' start')) throw new Error(`Command failed: ${cmd}\n${SYSBOX}`) })
    await composeStart('/s/p7y-a/docker-compose.yml', exec)
    expect(exec.mock.calls.map(c => c[0])).toEqual([
      'docker compose -f "/s/p7y-a/docker-compose.yml" start',
      'docker compose -f "/s/p7y-a/docker-compose.yml" up -d --force-recreate --pull never',
    ])
    warn.mockRestore()
  })

  it('passes any other failure on', async () => {
    const exec = vi.fn(async () => { throw new Error('no such service') })
    await expect(composeStart('/s/p7y-a/docker-compose.yml', exec)).rejects.toThrow('no such service')
    expect(exec).toHaveBeenCalledTimes(1)
  })
})
