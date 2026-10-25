import { describe, it, expect } from 'vitest'
import { measureBinds, volumeTarget } from '../../services/dataVolumes'

describe('measureBinds', () => {
  it('every volume of the sandbox is measured, each under /d', () => {
    expect(measureBinds(['p9m-a_docker_data', 'p9m-a_sandbox_opt'])).toEqual(['p9m-a_docker_data:/d/p9m-a_docker_data:ro', 'p9m-a_sandbox_opt:/d/p9m-a_sandbox_opt:ro'])
  })
})

describe('volumeTarget', () => {
  it('reads the target of the short and the long syntax', () => {
    expect(volumeTarget('sandbox_opt:/opt')).toBe('/opt')
    expect(volumeTarget({ type: 'bind', source: '/x', target: '/srv/x' })).toBe('/srv/x')
    expect(volumeTarget(null)).toBeUndefined()
  })
})
