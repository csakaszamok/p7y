import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { lastRunning, rememberLastRunning } from '../../services/lastRunning'

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lastrun-'))

describe('lastRunning', () => {
  it('a running sandbox: none (it runs now)', () => {
    expect(lastRunning({ status: 'running', finishedAt: '2026-10-01T10:00:00Z' }, dir())).toEqual({ at: null, estimated: false })
  })
  it('asleep: when its container stopped, exactly', () => {
    expect(lastRunning({ status: 'exited', finishedAt: '2026-10-01T10:00:00.123Z' }, dir())).toEqual({ at: '2026-10-01T10:00:00.123Z', estimated: false })
  })
  it('a container that never ran: unknown', () => {
    expect(lastRunning({ status: 'created', finishedAt: '0001-01-01T00:00:00Z' }, dir())).toEqual({ at: null, estimated: false })
  })
  it('deep sleep: what was remembered when it was taken down', () => {
    const d = dir()
    rememberLastRunning(d, '2026-09-01T08:00:00Z')
    expect(lastRunning(null, d)).toEqual({ at: '2026-09-01T08:00:00.000Z', estimated: false })
  })
  it('deep sleep from before this was remembered: about when it last showed its apps', () => {
    const d = dir()
    fs.writeFileSync(path.join(d, 'apps.json'), '[]')
    const t = new Date('2026-08-15T12:00:00Z')
    fs.utimesSync(path.join(d, 'apps.json'), t, t)
    expect(lastRunning(null, d)).toEqual({ at: '2026-08-15T12:00:00.000Z', estimated: true })
  })
  it('deep sleep with nothing to go by: unknown', () => {
    expect(lastRunning(null, dir())).toEqual({ at: null, estimated: false })
  })
})

describe('lastRunningOf', () => {
  it('reads the container state only when the sandbox is not running', async () => {
    const { lastRunningOf } = await import('../../services/lastRunning')
    let asked = 0
    const d = dir()
    const state = async () => { asked++; return { status: 'exited', finishedAt: '2026-10-01T10:00:00Z' } }
    expect(await lastRunningOf('p7y-x', 'running', { state, dir: () => d })).toEqual({ at: null, estimated: false })
    expect(asked).toBe(0)
    expect(await lastRunningOf('p7y-x', 'exited', { state, dir: () => d })).toEqual({ at: '2026-10-01T10:00:00.000Z', estimated: false })
    expect(await lastRunningOf('p7y-x', 'deep_sleep', { state: async () => null, dir: () => d })).toEqual({ at: null, estimated: false })
  })
})
