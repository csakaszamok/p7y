/**
 * sandboxPaths for tests whose fs is mocked: every sandbox sits in the legacy flat /opt/users/<name>
 * (what those tests' existsSync / readdirSync mocks describe); the rest is the real module.
 *   vi.mock('../../services/sandboxPaths', orig => legacySandboxPaths(orig))
 */
import type * as SandboxPaths from '../../services/sandboxPaths'

export async function legacySandboxPaths(orig: () => Promise<unknown>): Promise<typeof SandboxPaths> {
  const real = await orig() as typeof SandboxPaths
  const { default: fs } = await import('fs')
  const listSandboxDirs = () => (fs.existsSync('/opt/users') ? (fs.readdirSync('/opt/users') as unknown[]).map(String) : [])
    .filter(n => real.SANDBOX_NAME.test(n)).map(n => ({ name: n, owner: 'admin', dir: `/opt/users/${n}`, legacy: true }))
  const sandboxDir = (n: string) => real.SANDBOX_NAME.test(n) && fs.existsSync(`/opt/users/${n}`) ? `/opt/users/${n}` : null
  return { ...real, listSandboxDirs, entriesIn: (d?: string) => d === undefined ? listSandboxDirs() : real.entriesIn(d), sandboxDir, sandboxParent: () => '/opt/users' }
}
