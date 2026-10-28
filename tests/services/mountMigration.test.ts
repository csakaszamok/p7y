import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('../../services/compose', () => ({
  composeUp: vi.fn().mockResolvedValue(undefined),
  composeCreate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../services/docker', () => ({ getSandboxState: vi.fn() }))

import { withReadOnlyMounts, migrateReadOnlyMounts } from '../../services/mountMigration'
import { composeUp, composeCreate } from '../../services/compose'
import { getSandboxState } from '../../services/docker'

// What a runtime generated before 0.12.22, quoted (as in runtimes/*.yaml) or not (after yaml.dump)
const before = (dir: string, quoted = true) => {
  const q = (s: string) => quoted ? `"${s}"` : s
  return `services:
  sandbox:
    volumes:
      - ${q(`${dir}/certs:/certs`)}
      - ${q(`${dir}/instance-name:/etc/instance/name:ro`)}
      - ${q(`${dir}/ssh-host-keys:/etc/ssh/host-keys`)}
      - ${q(`${dir}/inner:/inner`)}
      - docker_data:/var/lib/docker
`
}
const state = (status: string, error = '') =>
  ({ name: 'x', status, finishedAt: '', deepSleepAfter: '7d', staleNetwork: false, error })

describe('withReadOnlyMounts', () => {
  for (const quoted of [true, false]) {
    it(`makes /inner read-only and mounts only the server certificate, read-only (${quoted ? 'quoted' : 'yaml.dump'})`, () => {
      const out = withReadOnlyMounts(before('/srv/p9m/opt/sandboxes/admin/p9m-a', quoted))
      const q = (s: string) => quoted ? `"${s}"` : s
      expect(out).toContain(`- ${q('/srv/p9m/opt/sandboxes/admin/p9m-a/certs/server:/certs/server:ro')}\n`)
      expect(out).toContain(`- ${q('/srv/p9m/opt/sandboxes/admin/p9m-a/inner:/inner:ro')}\n`)
      expect(out).toContain('ssh-host-keys:/etc/ssh/host-keys') // its sshd writes its host keys there
      expect(withReadOnlyMounts(out)).toBe(out) // once
    })
  }
})

describe('migrateReadOnlyMounts', () => {
  beforeEach(() => { vi.mocked(composeUp).mockClear(); vi.mocked(composeCreate).mockClear() })

  it('recreates a running sandbox, leaves an asleep one stopped, only rewrites a deep-sleeping one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p9m-mounts-'))
    for (const n of ['p9m-run', 'p9m-zzz', 'p9m-deep', 'p9m-new']) {
      fs.mkdirSync(`${dir}/${n}`)
      fs.writeFileSync(`${dir}/${n}/docker-compose.yml`, n === 'p9m-new' ? withReadOnlyMounts(before(`/h/${n}`)) : before(`/h/${n}`))
    }
    vi.mocked(getSandboxState).mockImplementation(async (n: string) => n === 'p9m-run' ? state('running') : n === 'p9m-zzz' ? state('exited') : null)
    expect((await migrateReadOnlyMounts(dir)).sort()).toEqual(['p9m-deep', 'p9m-run', 'p9m-zzz'])
    expect(vi.mocked(composeUp).mock.calls.map(c => path.basename(path.dirname(c[0])))).toEqual(['p9m-run'])
    expect(vi.mocked(composeCreate).mock.calls.map(c => path.basename(path.dirname(c[0])))).toEqual(['p9m-zzz'])
    expect(fs.readFileSync(`${dir}/p9m-deep/docker-compose.yml`, 'utf8')).toContain('/h/p9m-deep/inner:/inner:ro')
  })

  it('puts the file back when recreating fails, to try again on the next start', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p9m-mounts-'))
    fs.mkdirSync(`${dir}/p9m-a`)
    fs.writeFileSync(`${dir}/p9m-a/docker-compose.yml`, before('/h/p9m-a'))
    vi.mocked(getSandboxState).mockResolvedValue(state('running'))
    vi.mocked(composeUp).mockRejectedValueOnce(new Error('boom'))
    expect(await migrateReadOnlyMounts(dir)).toEqual([])
    expect(fs.readFileSync(`${dir}/p9m-a/docker-compose.yml`, 'utf8')).toBe(before('/h/p9m-a'))
  })
})
