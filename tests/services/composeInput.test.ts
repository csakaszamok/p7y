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

// The compose CLI runs inside the Purgatory container: these keys would make it read Purgatory's
// own files (other sandboxes' TLS keys, the token store) or environment (ADMIN_TOKEN) for the user
describe('checkCompose: nothing that makes the compose CLI read files or settings of the Purgatory server', () => {
  const svc = (extra: string) => 'services:\n  web:\n    image: nginx\n' + extra
  const cases: Array<[string, string]> = [
    [svc('    build: /opt/users\n'), 'services.web.build'],
    [svc('    build:\n      context: .\n'), 'services.web.build'],
    [svc('    env_file: /app/data/x.env\n'), 'services.web.env_file'],
    [svc('    label_file: ./labels\n'), 'services.web.label_file'],
    [svc('    extends:\n      file: /app/templates/starter/compose.yaml\n      service: portainer\n'), 'services.web.extends.file'],
    [svc('') + 'include:\n  - /app/templates/tcp-demo/compose.yaml\n', 'include'],
    [svc('') + 'secrets:\n  s:\n    file: /app/data/registry-auth.key\n', 'secrets.s.file'],
    [svc('') + 'configs:\n  c:\n    environment: ADMIN_TOKEN\n', 'configs.c.environment'],
  ]
  for (const [text, key] of cases) {
    it(`refuses ${key}`, () => {
      expect(checkCompose(text)).toBe(`compose may not use ${key}: it would read files or settings of the Purgatory server (build images and the like through DOCKER_HOST or Portainer)`)
    })
  }

  it('allows extends within the same file, external secrets and bind mounts (those are on the sandbox)', () => {
    const text = svc('    extends:\n      service: base\n    volumes:\n      - /data:/data\n  base:\n    image: nginx\n') + 'secrets:\n  s:\n    external: true\n'
    expect(checkCompose(text)).toBeNull()
  })
})
