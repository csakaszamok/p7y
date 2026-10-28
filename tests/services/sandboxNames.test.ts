import { describe, it, expect } from 'vitest'
import { generateSandboxName, randomSandboxName, GENERATED_NAME } from '../../services/sandboxNames'

describe('sandbox names', () => {
  it('six lower-case letters and digits, a letter first: a valid sandbox name and host label', () => {
    for (let i = 0; i < 2000; i++) {
      const n = randomSandboxName()
      expect(n).toMatch(GENERATED_NAME)
      expect(n).toMatch(/^[a-z0-9][a-z0-9_-]{0,62}$/)
    }
  })

  it('uses every character the given random picks', () => {
    expect(randomSandboxName(() => 0)).toBe('aaaaaa')
    expect(randomSandboxName(max => max - 1)).toBe('z99999')
  })

  it('skips taken names: thousands of sandboxes, every name different', () => {
    const taken = new Set<string>()
    for (let i = 0; i < 5000; i++) {
      const n = generateSandboxName(x => !taken.has(x))
      expect(n).not.toBeNull()
      taken.add(n!)
    }
    expect(taken.size).toBe(5000)
  })

  it('draws again while isFree says no; null when nothing is free', () => {
    let calls = 0
    expect(generateSandboxName(() => ++calls === 3)).toMatch(GENERATED_NAME)
    expect(calls).toBe(3)
    expect(generateSandboxName(() => false)).toBeNull()
  })
})
