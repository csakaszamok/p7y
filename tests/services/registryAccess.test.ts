import { describe, it, expect } from 'vitest'
import { grantFor } from '../../services/registryAccess'

const ctx = { publicPull: true, repoIsClean: (r: string) => r !== 'shop/dirty', ownedRaw: (o: string) => (o === 'alice' ? ['shop', 'blog'] : ['other']) }
const g = (who: Parameters<typeof grantFor>[0], scope: string, c = ctx) => grantFor(who, scope, c)

describe('grantFor', () => {
  it('a sandbox (scoped token or registry password): push and pull its own repos, pull only clean others', () => {
    expect(g({ kind: 'sandbox', raw: 'shop' }, 'repository:shop/todo:pull,push')).toEqual([{ type: 'repository', name: 'shop/todo', actions: ['pull', 'push'] }])
    expect(g({ kind: 'sandbox', raw: 'shop' }, 'repository:other/x:pull,push')).toEqual([{ type: 'repository', name: 'other/x', actions: ['pull'] }])
    expect(g({ kind: 'sandbox', raw: 'shop' }, 'repository:shopping/x:push')).toEqual([])
  })
  it('an owner: their sandboxes\' repos', () => {
    expect(g({ kind: 'owner', owner: 'alice' }, 'repository:blog/web:push')).toEqual([{ type: 'repository', name: 'blog/web', actions: ['push'] }])
    expect(g({ kind: 'owner', owner: 'alice' }, 'repository:other/web:push')).toEqual([])
  })
  it('the admin: everything, the catalog too', () => {
    expect(g({ kind: 'admin' }, 'repository:other/web:pull,push registry:catalog:*')).toEqual([
      { type: 'repository', name: 'other/web', actions: ['pull', 'push'] }, { type: 'registry', name: 'catalog', actions: ['*'] }])
  })
  it('anonymous: pull of a clean repo only, never push or the catalog; nothing when public pull is off', () => {
    expect(g({ kind: 'anonymous' }, 'repository:shop/todo:pull,push')).toEqual([{ type: 'repository', name: 'shop/todo', actions: ['pull'] }])
    expect(g({ kind: 'anonymous' }, 'repository:shop/dirty:pull')).toEqual([])
    expect(g({ kind: 'anonymous' }, 'registry:catalog:*')).toEqual([])
    expect(g({ kind: 'anonymous' }, 'repository:shop/todo:pull', { ...ctx, publicPull: false })).toEqual([])
  })
})
