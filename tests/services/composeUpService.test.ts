import { describe, it, expect, vi } from 'vitest'
import { composeUpService } from '../../services/compose'

describe('composeUpService', () => {
  // compose's own recreate makes the new container under a temporary name (<id>_<name>) and renames it at the end:
  // Sablier puts that name into the sandbox's group, and until its reconciliation (about a minute) the wake fails
  // with "No such container: <id>_<name>". Removing first, the new container is made under its own name.
  it('removes the service container first, then creates it under its own name (started or not)', async () => {
    const exec = vi.fn(async (_cmd: string) => {})
    await composeUpService('/s/p9m-a/docker-compose.yml', 'socat', true, exec)
    expect(exec.mock.calls.map(c => c[0])).toEqual([
      'docker compose -f "/s/p9m-a/docker-compose.yml" rm -s -f "socat"',
      'docker compose -f "/s/p9m-a/docker-compose.yml" up -d --no-deps "socat"',
    ])
    exec.mockClear()
    await composeUpService('/s/p9m-a/docker-compose.yml', 'sandbox', false, exec)
    expect(exec.mock.calls.map(c => c[0])).toEqual([
      'docker compose -f "/s/p9m-a/docker-compose.yml" rm -s -f "sandbox"',
      'docker compose -f "/s/p9m-a/docker-compose.yml" up --no-start --no-deps "sandbox"',
    ])
  })
})
