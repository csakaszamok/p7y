import { sandboxService } from './sandbox'
import type { Principal } from './principal'

export function canAccess(p: Principal, owner: string, name?: string): boolean {
  // A token limited to one sandbox sees nothing else, whoever owns it
  if (p.sandbox !== undefined && p.sandbox !== name) return false
  return p.role === 'admin' || owner === p.sub
}

/** A sandbox the caller may see; someone else's is reported exactly like a missing one. */
export async function getOwnedSandbox(p: Principal, name: string) {
  const sandbox = await sandboxService.getSandbox(name)
  if (!canAccess(p, sandbox.owner, sandbox.name)) throw new Error(`Sandbox not found: ${name}`)
  return sandbox
}

export async function visibleSandboxes(p: Principal) {
  const all = await sandboxService.listSandboxes()
  return all.filter(s => canAccess(p, s.owner, s.name))
}
