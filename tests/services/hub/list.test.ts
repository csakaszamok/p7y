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
  instance: n => n.replace(/^p7y-/, ''),
  dir: n => { const d = path.join(root, n); fs.mkdirSync(d, { recursive: true }); return d },
  now: () => clock,
  nameOf: e => (e === 'anna@example.com' ? 'Anna' : null),
})

beforeEach(() => { forgetHubList(); process.env.HOST_DOMAIN = 'example.com'; process.env.PUBLIC_URL = 'https://p7y.example.com' })

describe('hubEntries', () => {
  it('lists a running sandbox’s published apps with owner, name and status', async () => {
    containers = { 'p7y-shop': [web('web', { 'p7y.publish': 'true', 'p7y.title': 'Stock room' })] }
    const list = await hubEntries(deps([meta('p7y-shop', 'running')]))
    expect(list).toEqual([expect.objectContaining({ id: 'shop-inner-web-port8080.example.com', title: 'Stock room', owner: 'anna@example.com', owner_name: 'Anna', sandbox: 'p7y-shop', status: 'running', updated_at: '2026-10-20T10:00:00.000Z' })])
  })
  it('shows an asleep sandbox from what it remembered, and keeps updated_at when nothing changed', async () => {
    containers = { 'p7y-shop': [web('web', { 'p7y.publish': 'true' })] }
    await hubEntries(deps([meta('p7y-shop', 'running')]))
    forgetHubList(); clock += 3_600_000
    containers = {}
    const asleep = await hubEntries(deps([meta('p7y-shop', 'exited')]))
    expect(asleep[0]).toMatchObject({ status: 'asleep', updated_at: '2026-10-20T10:00:00.000Z' })
    const deep = (forgetHubList(), await hubEntries(deps([meta('p7y-shop', 'deep_sleep')])))
    expect(deep[0].status).toBe('deep_sleep')
  })
  it('moves updated_at when the title changes', async () => {
    containers = { 'p7y-shop': [web('web', { 'p7y.publish': 'true', 'p7y.title': 'A' })] }
    await hubEntries(deps([meta('p7y-shop', 'running')]))
    forgetHubList(); clock += 60_000
    containers = { 'p7y-shop': [web('web', { 'p7y.publish': 'true', 'p7y.title': 'B' })] }
    expect((await hubEntries(deps([meta('p7y-shop', 'running')])))[0].updated_at).toBe(new Date(clock).toISOString())
  })
  it('keeps the remembered entries when the daemon lists no containers (right after a wake)', async () => {
    containers = { 'p7y-shop': [web('web', { 'p7y.publish': 'true' })] }
    await hubEntries(deps([meta('p7y-shop', 'running')]))
    forgetHubList(); containers = { 'p7y-shop': [] }
    expect(await hubEntries(deps([meta('p7y-shop', 'running')]))).toHaveLength(1)
  })
  it('a running sandbox with containers but no labels clears its entries', async () => {
    containers = { 'p7y-shop': [web('web', { 'p7y.publish': 'true' })] }
    await hubEntries(deps([meta('p7y-shop', 'running')]))
    forgetHubList(); containers = { 'p7y-shop': [web('web', {})] }
    expect(await hubEntries(deps([meta('p7y-shop', 'running')]))).toEqual([])
  })
  it('an unreachable daemon falls back to the remembered entries, and one broken sandbox does not hide others', async () => {
    containers = { 'p7y-shop': [web('web', { 'p7y.publish': 'true' })], 'p7y-blog': [web('blog', { 'p7y.publish': 'true' })] }
    await hubEntries(deps([meta('p7y-shop', 'running'), meta('p7y-blog', 'running')]))
    forgetHubList(); containers = { 'p7y-shop': new Error('ECONNREFUSED'), 'p7y-blog': [web('blog', { 'p7y.publish': 'true' })] }
    expect((await hubEntries(deps([meta('p7y-shop', 'running'), meta('p7y-blog', 'running')]))).map(e => e.sandbox).sort()).toEqual(['p7y-blog', 'p7y-shop'])
  })
  it('a sandbox no longer listed (archived) leaves the Hub; the answer is cached 30 s', async () => {
    containers = { 'p7y-shop': [web('web', { 'p7y.publish': 'true' })] }
    expect(await hubEntries(deps([meta('p7y-shop', 'running')]))).toHaveLength(1)
    expect(await hubEntries(deps([]))).toHaveLength(1) // cached
    clock += 31_000
    expect(await hubEntries(deps([]))).toEqual([])
  })
})

describe('hubEntries: apps that are briefly missing', () => {
  it('an app missing from one read (a partial wake or a recreate) keeps its first date when it comes back', async () => {
    const both = [web('web', { 'p7y.publish': 'true' }), web('other', { 'p7y.publish': 'true' })]
    containers = { 'p7y-part': both }
    await hubEntries(deps([meta('p7y-part', 'running')]))
    const first = new Date(clock).toISOString()
    forgetHubList(); clock += 3_600_000
    containers = { 'p7y-part': [both[1]] }
    await hubEntries(deps([meta('p7y-part', 'running')]))
    forgetHubList(); clock += 3_600_000
    containers = { 'p7y-part': both }
    const back = (await hubEntries(deps([meta('p7y-part', 'running')]))).find(e => e.service === 'web')!
    expect(back.updated_at).toBe(first)
  })
  it('a running sandbox whose daemon stays empty (compose down) drops its apps after two minutes', async () => {
    containers = { 'p7y-down': [web('web', { 'p7y.publish': 'true' })] }
    await hubEntries(deps([meta('p7y-down', 'running')]))
    forgetHubList(); containers = { 'p7y-down': [] }
    expect(await hubEntries(deps([meta('p7y-down', 'running')]))).toHaveLength(1)
    forgetHubList(); clock += 60_000
    expect(await hubEntries(deps([meta('p7y-down', 'running')]))).toHaveLength(1)
    forgetHubList(); clock += 90_000
    expect(await hubEntries(deps([meta('p7y-down', 'running')]))).toEqual([])
  })
})

describe('hubEntries: when an asleep app last ran', () => {
  it('asks only for sandboxes that are not running, and carries it on each of their apps', async () => {
    containers = { 'p7y-ran': [web('web', { 'p7y.publish': 'true' })] }
    const asked: string[] = []
    const lastRan = async (n: string, status: string) => { asked.push(`${n}:${status}`); return { at: '2026-09-01T08:00:00.000Z', estimated: false } }
    forgetHubList()
    const up = await hubEntries({ ...deps([meta('p7y-ran', 'running')]), lastRan })
    expect(up[0]).toMatchObject({ last_ran_at: null, last_ran_estimated: false })
    expect(asked).toEqual([])
    forgetHubList()
    const down = await hubEntries({ ...deps([meta('p7y-ran', 'exited')]), lastRan })
    expect(down[0]).toMatchObject({ status: 'asleep', last_ran_at: '2026-09-01T08:00:00.000Z', last_ran_estimated: false })
    expect(asked).toEqual(['p7y-ran:exited'])
  })
})
