import { describe, it, expect } from 'vitest'
import { checkCompose, COMPOSE_MAX_BYTES } from '../../services/composeInput'

describe('checkCompose', () => {
  it('accepts a compose file with a service (comments and ${variables} included)', () => {
    expect(checkCompose('# hi\nservices:\n  web:\n    image: nginx:${tag}\n')).toBeNull()
  })

  it('names the YAML error and its line', () => {
    expect(checkCompose('services:\n  web:\n    image: nginx\n   bad: [\n')).toMatch(/^compose is not valid YAML: .+ \(line \d+\)$/)
  })

  it('wants at least one service', () => {
    for (const text of ['services: {}\n', 'services:\n', 'version: "3"\n', 'just text', '- a\n- b\n', '']) {
      expect(checkCompose(text), JSON.stringify(text)).toBe('compose needs at least one service under services:')
    }
  })

  it('wants a string of at most 256 KB', () => {
    expect(checkCompose(42)).toBe('compose must be a string')
    expect(checkCompose('services:\n  web:\n    image: x\n#' + 'x'.repeat(COMPOSE_MAX_BYTES))).toBe('compose must be at most 256 KB')
  })
})

// docker compose runs in the sandbox (composeUpInner): what these read or build is the sandbox's own
describe("checkCompose: build, env_file, include and the like are the sandbox's business", () => {
  const svc = (extra: string) => 'services:\n  web:\n    image: nginx\n' + extra
  for (const text of [
    svc('    build:\n      context: .\n'), svc('    env_file: ./x.env\n'), svc('    label_file: ./labels\n'),
    svc('    extends:\n      file: ./base.yaml\n      service: web\n'), svc('') + 'include:\n  - ./more.yaml\n',
    svc('') + 'secrets:\n  s:\n    file: ./s.txt\n', svc('    provider:\n      type: model\n'),
  ]) {
    it(`takes ${JSON.stringify(text.split('\n').slice(3).join(' ').trim())}`, () => expect(checkCompose(text)).toBeNull())
  }
})
