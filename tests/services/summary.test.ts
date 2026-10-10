import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { summaryFor, archivedOwners } from '../../services/summary'

const live = [
  { name: 'p7y-a', owner: 'alice@x', status: 'running' },
  { name: 'p7y-b', owner: 'alice@x', status: 'exited' },
  { name: 'p7y-c', owner: 'alice@x', status: 'deep_sleep' },
  { name: 'p7y-d', owner: 'bob@x', status: 'exited' },
  { name: 'p7y-e', owner: 'admin', status: 'running' },
]
const resources = { cpu: { used: 0.5, reserved: 4, host: 20 }, memory: { used: 2e9, reserved: 8e9, host: 16e9 }, disk: { used: 30e9, over: 1 } }
const deps = { list: async () => live, archived: async () => ['alice@x', 'alice@x', 'carol@x'], quota: () => 3 as number | null, server: () => null as number | null, running: () => 1 as number | null, resources: async () => resources }
const alice = { sub: 'alice@x', role: 'user' as const }
const admin = { sub: 'admin', role: 'admin' as const }

describe('summaryFor', () => {
  it("a user: their own sandboxes by state, against their quota", async () => {
    expect(await summaryFor(alice, deps)).toEqual({ quota: 3, total: 3, free: 2, running: 1, asleep: 1, deep_sleep: 1, archived: 2, max_running: 1, server_full: false })
  })
  it('unlimited quota: free is null', async () => {
    expect(await summaryFor({ sub: 'bob@x', role: 'user' }, { ...deps, quota: () => null })).toEqual({ quota: null, total: 1, free: null, running: 0, asleep: 1, deep_sleep: 0, archived: 0, max_running: 1, server_full: false })
  })
  it('the admin: the whole server, and per owner (also owners with only archived sandboxes)', async () => {
    const s = await summaryFor(admin, deps)
    expect(s).toMatchObject({ quota: null, free: null, total: 5, running: 2, asleep: 2, deep_sleep: 1, archived: 3, server_limit: null, server_used: 4, resources })
    expect(s.by_owner).toEqual([
      { owner: 'admin', quota: null, total: 1, free: null, running: 1, asleep: 0, deep_sleep: 0, archived: 0, max_running: null },
      { owner: 'alice@x', quota: 3, total: 3, free: 2, running: 1, asleep: 1, deep_sleep: 1, archived: 2, max_running: 1 },
      { owner: 'bob@x', quota: 3, total: 1, free: 3, running: 0, asleep: 1, deep_sleep: 0, archived: 0, max_running: 1 },
      { owner: 'carol@x', quota: 3, total: 0, free: 3, running: 0, asleep: 0, deep_sleep: 0, archived: 1, max_running: 1 },
    ])
  })
})

describe('summaryFor, server places', () => {
  it("every sandbox that holds a network counts, the admin's too; one in deep sleep does not", async () => {
    const d = { ...deps, server: () => 2, list: async () => [
      { name: 'p7y-x', owner: 'admin', status: 'running' }, { name: 'p7y-y', owner: 'admin', status: 'exited' }, { name: 'p7y-z', owner: 'alice@x', status: 'deep_sleep' },
    ] }
    expect(await summaryFor(admin, d)).toMatchObject({ server_limit: 2, server_used: 2 })
    expect((await summaryFor(alice, d)).server_full).toBe(true)
  })
})

describe('summaryFor, server limit', () => {
  it("the admin sees the users' sandboxes against SANDBOX_MAX_TOTAL; a user only whether it is full", async () => {
    const d = { ...deps, server: () => 4 }
    expect(await summaryFor(admin, d)).toMatchObject({ server_limit: 4, server_used: 4 })
    const a = await summaryFor(alice, d)
    expect(a.server_full).toBe(true)
    expect(a).not.toHaveProperty('server_used')
    expect(a).not.toHaveProperty('resources')
  })
})

describe('archivedOwners', () => {
  it("reads each archive's owner from its compose file; legacy labels too, admin without one; skips non-archives", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-arch-'))
    const arch = (n: string, compose: string | null) => {
      fs.mkdirSync(`${dir}/${n}/config`, { recursive: true })
      fs.writeFileSync(`${dir}/${n}/manifest.json`, JSON.stringify({ name: n }))
      if (compose !== null) fs.writeFileSync(`${dir}/${n}/config/docker-compose.yml`, compose)
    }
    arch('p7y-a-2026', 'services:\n  sandbox:\n    labels:\n      p7y.owner: "alice@x"\n')
    arch('leander-b-2026', 'services:\n  sandbox:\n    labels:\n      leander.owner: bob@x\n')
    arch('p7y-c-2026', null)
    // A bulk save of orphan volumes: a manifest, but no sandbox config
    fs.mkdirSync(`${dir}/_orphan-volumes-2026`)
    fs.writeFileSync(`${dir}/_orphan-volumes-2026/manifest.json`, '{}')
    expect((await archivedOwners(dir)).sort()).toEqual(['admin', 'alice@x', 'bob@x'])
    expect(await archivedOwners(`${dir}/missing`)).toEqual([])
  })
})

describe('archivedOwners in the per-owner layout', () => {
  it('reads archives under owner directories (manifest owner first), and flat ones not moved yet', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-arch2-'))
    fs.mkdirSync(`${dir}/carol@x/p7y-a-2026/config`, { recursive: true })
    fs.writeFileSync(`${dir}/carol@x/p7y-a-2026/manifest.json`, JSON.stringify({ name: 'p7y-a', owner: 'Carol@x' }))
    fs.mkdirSync(`${dir}/admin/p7y-b-2026/config`, { recursive: true })
    fs.writeFileSync(`${dir}/admin/p7y-b-2026/manifest.json`, JSON.stringify({ name: 'p7y-b' }))
    fs.mkdirSync(`${dir}/p7y-c-2026/config`, { recursive: true })
    fs.writeFileSync(`${dir}/p7y-c-2026/manifest.json`, JSON.stringify({ name: 'p7y-c' }))
    fs.writeFileSync(`${dir}/p7y-c-2026/config/docker-compose.yml`, '      p7y.owner: dave@x\n')
    expect((await archivedOwners(dir)).sort()).toEqual(['Carol@x', 'admin', 'dave@x'])
  })
})
