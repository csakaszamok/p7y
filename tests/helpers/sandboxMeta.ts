import type { SandboxMeta } from '../../services/docker'

/** A sandbox as listManagedContainers gives it: what a test does not set gets a neutral value
 * (owner '' rather than a name, so a test that left it out still has no owner). */
export const sandboxMeta = (m: Pick<SandboxMeta, 'name'> & Partial<SandboxMeta>): SandboxMeta =>
  ({ template: 't', runtime: '', compose: 'template', ssh: false, owner: '', status: 'running', container_id: 'x', created_at: '', ...m })
