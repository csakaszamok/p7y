/**
 * sandboxPaths for tests whose fs is mocked: every sandbox sits in /opt/sandboxes/admin/<name>
 * (what those tests' existsSync / readdirSync mocks describe); the rest is the real module.
 *   vi.mock('../../services/sandboxPaths', orig => flatSandboxPaths(orig))
 */
import type * as SandboxPaths from '../../services/sandboxPaths'

export async function flatSandboxPaths(orig: () => Promise<unknown>): Promise<typeof SandboxPaths> {
  const real = await orig() as typeof SandboxPaths
  const { default: fs } = await import('fs')
  const listSandboxDirs = () => (fs.existsSync('/opt/sandboxes/admin') ? (fs.readdirSync('/opt/sandboxes/admin') as unknown[]).map(String) : [])
    .filter(n => real.SANDBOX_NAME.test(n)).map(n => ({ name: n, owner: 'admin', dir: `/opt/sandboxes/admin/${n}` }))
  const sandboxDir = (n: string) => real.SANDBOX_NAME.test(n) && fs.existsSync(`/opt/sandboxes/admin/${n}`) ? `/opt/sandboxes/admin/${n}` : null
  return { ...real, listSandboxDirs, entriesIn: (d?: string) => d === undefined ? listSandboxDirs() : real.entriesIn(d), sandboxDir, sandboxParent: () => '/opt/sandboxes/admin' }
}
