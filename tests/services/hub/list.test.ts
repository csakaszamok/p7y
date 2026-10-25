import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hubEntries, forgetHubList, type HubListDeps } from '../../../services/hub/list'
import type { InnerContainer } from '../../../services/tcpNames'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hublist-'))
const web = (name: string, labels: Record<string, string>): InnerContainer =>
  ({ Names: [`/${name}`], Labels: { 'com.docker.compose.project': 'inner', 'com.docker.compose.service': name, ...labels }, Ports: [{ IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' }] })
const meta = (name: string, status: string, owner = 'anna@example.com') => ({ name, status, owner } as any)

let containers: Record<string, InnerContainer[] | Error>
let clock = Date.parse('2026-10-20T10:00:00Z')
const deps = (states: any[]): Partial<HubListDeps> => ({
  states: async () => states,
  containers: async n => { const c = containers[n]; if (c instanceof Error) throw c; return c ?? [] },
  instance: n => n.replace(/^p9m-/, ''),
  dir: n => { const d = path.join(root, n); fs.mkdirSync(d, { recursive: true }); return d },
  now: () => clock,
  nameOf: e => (e === 'anna@example.com' ? 'Anna' : null),
})

beforeEach(() => { forgetHubList(); process.env.HOST_DOMAIN = 'example.com'; process.env.PUBLIC_URL = 'https://p9m.example.com' })

describe('hubEntries', () => {
  it('lists a running sandbox’s published apps with owner, name and status', async () => {
    containers = { 'p9m-shop': [web('web', { 'p9m.publish': 'true', 'p9m.title': 'Stock room' })] }
    const list = await hubEntries(deps([meta('p9m-shop', 'running')]))
    expect(list).toEqual([expect.objectContaining({ id: 'shop-inner-web-port8080.example.com', title: 'Stock room', owner: 'anna@example.com', owner_name: 'Anna', sandbox: 'p9m-shop', status: 'running', updated_at: '2026-10-20T10:00:00.000Z' })])
  })
  it('shows an asleep sandbox from what it remembered, and keeps updated_at when nothing changed', async () => {
    containers = { 'p9m-shop': [web('web', { 'p9m.publish': 'true' })] }
    await hubEntries(deps([meta('p9m-shop', 'running')]))
    forgetHubList(); clock += 3_600_000
    containers = {}
    const asleep = await hubEntries(deps([meta('p9m-shop', 'exited')]))
    expect(asleep[0]).toMatchObject({ status: 'asleep', updated_at: '2026-10-20T10:00:00.000Z' })
    const deep = (forgetHubList(), await hubEntries(deps([meta('p9m-shop', 'deep_sleep')])))
    expect(deep[0].status).toBe('deep_sleep')
  })
  it('moves updated_at when the title changes', async () => {
    containers = { 'p9m-shop': [web('web', { 'p9m.publish': 'true', 'p9m.title': 'A' })] }
    await hubEntries(deps([meta('p9m-shop', 'running')]))
    forgetHubList(); clock += 60_000
    containers = { 'p9m-shop': [web('web', { 'p9m.publish': 'true', 'p9m.title': 'B' })] }
    expect((await hubEntries(deps([meta('p9m-shop', 'running')])))[0].updated_at).toBe(new Date(clock).toISOString())
  })
  it('keeps the remembered entries when the daemon lists no containers (right after a wake)', async () => {
    containers = { 'p9m-shop': [web('web', { 'p9m.publish': 'true' })] }
    await hubEntries(deps([meta('p9m-shop', 'running')]))
    forgetHubList(); containers = { 'p9m-shop': [] }
    expect(await hubEntries(deps([meta('p9m-shop', 'running')]))).toHaveLength(1)
  })
  it('a running sandbox with containers but no labels clears its entries', async () => {
    containers = { 'p9m-shop': [web('web', { 'p9m.publish': 'true' })] }
    await hubEntries(deps([meta('p9m-shop', 'running')]))
    forgetHubList(); containers = { 'p9m-shop': [web('web', {})] }
    expect(await hubEntries(deps([meta('p9m-shop', 'running')]))).toEqual([])
  })
  it('an unreachable daemon falls back to the remembered entries, and one broken sandbox does not hide others', async () => {
    containers = { 'p9m-shop': [web('web', { 'p9m.publish': 'true' })], 'p9m-blog': [web('blog', { 'p9m.publish': 'true' })] }
    await hubEntries(deps([meta('p9m-shop', 'running'), meta('p9m-blog', 'running')]))
    forgetHubList(); containers = { 'p9m-shop': new Error('ECONNREFUSED'), 'p9m-blog': [web('blog', { 'p9m.publish': 'true' })] }
    expect((await hubEntries(deps([meta('p9m-shop', 'running'), meta('p9m-blog', 'running')]))).map(e => e.sandbox).sort()).toEqual(['p9m-blog', 'p9m-shop'])
  })
  it('a sandbox no longer listed (archived) leaves the Hub; the answer is cached 30 s', async () => {
    containers = { 'p9m-shop': [web('web', { 'p9m.publish': 'true' })] }
    expect(await hubEntries(deps([meta('p9m-shop', 'running')]))).toHaveLength(1)
    expect(await hubEntries(deps([]))).toHaveLength(1) // cached
    clock += 31_000
    expect(await hubEntries(deps([]))).toEqual([])
  })
})

describe('hubEntries: apps that are briefly missing', () => {
  it('an app missing from one read (a partial wake or a recreate) keeps its first date when it comes back', async () => {
    const both = [web('web', { 'p9m.publish': 'true' }), web('other', { 'p9m.publish': 'true' })]
    containers = { 'p9m-part': both }
    await hubEntries(deps([meta('p9m-part', 'running')]))
    const first = new Date(clock).toISOString()
    forgetHubList(); clock += 3_600_000
    containers = { 'p9m-part': [both[1]] }
    await hubEntries(deps([meta('p9m-part', 'running')]))
    forgetHubList(); clock += 3_600_000
    containers = { 'p9m-part': both }
    const back = (await hubEntries(deps([meta('p9m-part', 'running')]))).find(e => e.service === 'web')!
    expect(back.updated_at).toBe(first)
  })
  it('a running sandbox whose daemon stays empty (compose down) drops its apps after two minutes', async () => {
    containers = { 'p9m-down': [web('web', { 'p9m.publish': 'true' })] }
    await hubEntries(deps([meta('p9m-down', 'running')]))
    forgetHubList(); containers = { 'p9m-down': [] }
    expect(await hubEntries(deps([meta('p9m-down', 'running')]))).toHaveLength(1)
    forgetHubList(); clock += 60_000
    expect(await hubEntries(deps([meta('p9m-down', 'running')]))).toHaveLength(1)
    forgetHubList(); clock += 90_000
    expect(await hubEntries(deps([meta('p9m-down', 'running')]))).toEqual([])
  })
})

describe('hubEntries: when an asleep app last ran', () => {
  it('asks only for sandboxes that are not running, and carries it on each of their apps', async () => {
    containers = { 'p9m-ran': [web('web', { 'p9m.publish': 'true' })] }
    const asked: string[] = []
    const lastRan = async (n: string, status: string) => { asked.push(`${n}:${status}`); return { at: '2026-09-01T08:00:00.000Z', estimated: false } }
    forgetHubList()
    const up = await hubEntries({ ...deps([meta('p9m-ran', 'running')]), lastRan })
    expect(up[0]).toMatchObject({ last_ran_at: null, last_ran_estimated: false })
    expect(asked).toEqual([])
    forgetHubList()
    const down = await hubEntries({ ...deps([meta('p9m-ran', 'exited')]), lastRan })
    expect(down[0]).toMatchObject({ status: 'asleep', last_ran_at: '2026-09-01T08:00:00.000Z', last_ran_estimated: false })
    expect(asked).toEqual(['p9m-ran:exited'])
  })
})
