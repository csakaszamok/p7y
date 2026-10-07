export type RegistryAccess = Array<{ type: 'repository' | 'registry'; name: string; actions: string[] }>
export type Who = { kind: 'admin' } | { kind: 'sandbox'; raw: string } | { kind: 'owner'; owner: string } | { kind: 'anonymous' }

/**
 * What a registry token may do, per requested scope ("repository:shop/todo:pull,push registry:catalog:*").
 * Push only into one's own namespaces; pull of one's own, or of any repo whose versions all passed the
 * secret scan (when public pull is on); the catalog only for the admin.
 */
export function grantFor(who: Who, scope: string, ctx: { publicPull: boolean; repoIsClean: (repo: string) => boolean; ownedRaw: (owner: string) => string[] }): RegistryAccess {
  const out: RegistryAccess = []
  for (const s of scope.split(' ').filter(Boolean)) {
    const parts = s.split(':')
    if (parts.length < 3) continue
    const [type, name] = parts
    const requested = parts.slice(2).join(':').split(',')
    if (type === 'registry') {
      if (who.kind === 'admin' && name === 'catalog') out.push({ type: 'registry', name, actions: requested })
      continue
    }
    if (type !== 'repository') continue
    const ns = name.split('/')[0]
    const own = who.kind === 'admin' || (who.kind === 'sandbox' && ns === who.raw) || (who.kind === 'owner' && ctx.ownedRaw(who.owner).includes(ns))
    const publicPull = ctx.publicPull && ctx.repoIsClean(name)
    const actions = requested.filter(a => (a === 'push' ? own : a === 'pull' ? own || publicPull : false))
    if (actions.length) out.push({ type: 'repository', name, actions })
  }
  return out
}
