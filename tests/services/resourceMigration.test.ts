import { describe, it, expect, vi, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const { migrateResourceLimits } = await import('../../services/resourceMigration')
const G = 1024 ** 3
const users = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-resmig-'))
afterAll(() => fs.rmSync(users, { recursive: true, force: true }))
const mk = (name: string, extra = '') => {
  fs.mkdirSync(path.join(users, name))
  fs.writeFileSync(path.join(users, name, 'docker-compose.yml'), `services:\n  sandbox:\n    image: x\n${extra}`)
}

describe('migrateResourceLimits', () => {
  it('gives sandboxes without limits the default, applies it to existing containers, skips a running one already over it', async () => {
    mk('p7y-old'); mk('p7y-big'); mk('p7y-asleep'); mk('p7y-deep')
    mk('p7y-new', '    cpus: 1\n    mem_limit: 1024m\n    memswap_limit: 1024m\n')
    const update = vi.fn(async () => {})
    const log = vi.fn()
    await migrateResourceLimits({
      usersDir: users, defaults: { cpus: 2, memory: 4 * G }, update, log,
      state: async (n: string) => (n === 'p7y-asleep' ? 'exited' : n === 'p7y-deep' ? undefined : 'running'),
      memoryInUse: async (n: string) => (n === 'p7y-big' ? 5 * G : 1 * G),
    })
    for (const n of ['p7y-old', 'p7y-asleep', 'p7y-deep']) {
      expect(fs.readFileSync(path.join(users, n, 'docker-compose.yml'), 'utf8'), n).toContain('mem_limit: 4096m')
    }
    // Not limited now: left as it was (limits: null, tried again at the next start), not a limit it does not have
    expect(fs.readFileSync(path.join(users, 'p7y-big', 'docker-compose.yml'), 'utf8')).not.toContain('mem_limit')
    expect(fs.readFileSync(path.join(users, 'p7y-new', 'docker-compose.yml'), 'utf8')).toContain('mem_limit: 1024m')
    expect(update.mock.calls.map(c => c[0]).sort()).toEqual(['p7y-asleep', 'p7y-old'])
    expect(log.mock.calls.join(' ')).toContain('p7y-big')
  })
})

describe('migrateResourceLimits without a directory', () => {
  it("limits sandboxes in their owner's directory", async () => {
    const { forgetSandboxDir } = await import('../../services/sandboxPaths')
    const saved = process.env.SANDBOXES_DIR
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-owners-'))
    process.env.SANDBOXES_DIR = root; forgetSandboxDir()
    try {
      fs.mkdirSync(path.join(root, 'admin', 'p7y-o'), { recursive: true })
      fs.writeFileSync(path.join(root, 'admin', 'p7y-o', 'docker-compose.yml'), 'services:\n  sandbox:\n    image: x\n')
      await migrateResourceLimits({ defaults: { cpus: 2, memory: 4 * G }, update: vi.fn(async () => {}), log: vi.fn(), state: async () => undefined })
      expect(fs.readFileSync(path.join(root, 'admin', 'p7y-o', 'docker-compose.yml'), 'utf8')).toContain('mem_limit: 4096m')
    } finally { process.env.SANDBOXES_DIR = saved; forgetSandboxDir() }
  })
})
