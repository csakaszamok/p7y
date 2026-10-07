import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: string[][] = []
let psOutput = ''

vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof import('node:child_process')>()
  const execFile = (cmd: string, args: string[], cb: (err: Error | null, res: { stdout: string; stderr: string }) => void) => {
    calls.push([cmd, ...args])
    cb(null, { stdout: args[0] === 'ps' || args[0] === 'volume' ? psOutput : '', stderr: '' })
  }
  // promisify uses the custom symbol when present; mimic child_process.execFile's { stdout, stderr } result
  ;(execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] =
    (cmd: string, args: string[]) => new Promise(resolve => execFile(cmd, args, (_e, res) => resolve(res)))
  return { ...actual, execFile }
})

import { stopProjectContainers, removeProjectContainers, listProjectVolumes, nudgeTraefik } from '../../services/project'

describe('project helpers', () => {
  beforeEach(() => { calls.length = 0; psOutput = '' })

  it('stops all containers carrying the compose project label', async () => {
    psOutput = 'aaa\nbbb\n'
    await stopProjectContainers('leander-x')
    expect(calls).toEqual([
      ['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=leander-x'],
      ['docker', 'stop', 'aaa', 'bbb']
    ])
  })

  it('does nothing when the project has no containers', async () => {
    await removeProjectContainers('leander-x')
    expect(calls).toHaveLength(1)
  })

  it('force-removes leftover containers', async () => {
    psOutput = 'ccc\n'
    await removeProjectContainers('leander-x')
    expect(calls[1]).toEqual(['docker', 'rm', '-f', 'ccc'])
  })

  it('nudges Traefik with a throwaway container (start/die events)', async () => {
    await nudgeTraefik()
    expect(calls).toEqual([['docker', 'run', '--rm', '--network', 'none', 'alpine', 'true']])
  })

  it('lists project volumes by label', async () => {
    psOutput = 'leander-x_docker_data\n\n'
    expect(await listProjectVolumes('leander-x')).toEqual(['leander-x_docker_data'])
  })
})
