import { dockerRuntimes } from './docker'

/** sysbox needs this OCI runtime on the host (Linux only; not in Docker Desktop) */
const SYSBOX_RUNC = 'sysbox-runc'
let installed: Promise<string[]> | null = null
const hostRuntimes = () => (installed ??= dockerRuntimes().catch(() => []))

/** Tests: ask Docker again. */
export function _resetDefaultRuntime(): void { installed = null }

/**
 * The runtime for a sandbox when a request names none. DEFAULT_RUNTIME=auto (the default) picks sysbox — no
 * privileged container — where the host has sysbox-runc, and dind otherwise; a named runtime is kept as it is.
 */
export async function defaultRuntime(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const raw = env.DEFAULT_RUNTIME || 'auto'
  if (raw !== 'auto') return raw
  return (await hostRuntimes()).includes(SYSBOX_RUNC) ? 'sysbox' : 'dind'
}

/** Why this runtime cannot run on this host, or null: sysbox without sysbox-runc. */
export async function runtimeMissing(name: string): Promise<string | null> {
  if (name !== 'sysbox' || (await hostRuntimes()).includes(SYSBOX_RUNC)) return null
  return 'sysbox is not installed on this host (no sysbox-runc runtime in Docker): install sysbox, or use the dind runtime'
}
