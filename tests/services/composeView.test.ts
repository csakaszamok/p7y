import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { maskSecrets, starterStack } from '../../services/composeView'

describe('starterStack', () => {
  it('returns the starter stack masked, or null without one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-users-'))
    fs.mkdirSync(`${dir}/p7y-a/inner`, { recursive: true })
    fs.writeFileSync(`${dir}/p7y-a/docker-compose.yml`, 'services: {}\n')
    fs.writeFileSync(`${dir}/p7y-a/inner/docker-compose.yml`, "services:\n  portainer:\n    command: ['--admin-password', '$$2b$$10$$e4iVns7DQm34lndd8x6ZYOv7i4tl3sNqa/4tTSGGVVocpaCROsxZ2']\n")
    expect(starterStack('p7y-a', dir)).toContain('portainer')
    expect(starterStack('p7y-a', dir)).not.toContain('e4iVns7DQm34')
    fs.mkdirSync(`${dir}/p7y-b`)
    fs.writeFileSync(`${dir}/p7y-b/docker-compose.yml`, 'services: {}\n')
    expect(starterStack('p7y-b', dir)).toBeNull()
    expect(() => starterStack('p7y-none', dir)).toThrow(/not found/)
  })
})

describe('maskSecrets', () => {
  it('hides the FRP token and other token/password/secret/key values, map and list form', () => {
    const text = [
      'services:',
      '  sandbox:',
      '    environment:',
      '      FRP_TOKEN: 1dcc1b435bc7b9913d990facf4eb669b',
      '      FRP_SERVER_ADDR: "p7y-shop-frps"',
      '      DB_PASSWORD: "hunter2"',
      '      - API_KEY=abc123def',
      '      - CLIENT_SECRET=s3cr3t',
      '      REGISTRY_TOKEN: \'xyz\'',
    ].join('\n')
    const out = maskSecrets(text)
    expect(out).toContain('FRP_TOKEN: •••')
    expect(out).toContain('DB_PASSWORD: •••')
    expect(out).toContain('- API_KEY=•••')
    expect(out).toContain('- CLIENT_SECRET=•••')
    expect(out).toContain('REGISTRY_TOKEN: •••')
    expect(out).toContain('FRP_SERVER_ADDR: "p7y-shop-frps"')
    for (const secret of ['1dcc1b435bc7b9913d990facf4eb669b', 'hunter2', 'abc123def', 's3cr3t', 'xyz']) expect(out).not.toContain(secret)
  })

  it('hides bcrypt hashes, also compose-escaped ($$)', () => {
    const text = [
      "      - '--admin-password'",
      '      - $$2b$$10$$e4iVns7DQm34lndd8x6ZYOv7i4tl3sNqa/4tTSGGVVocpaCROsxZ2',
      '      - $2a$12$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    ].join('\n')
    const out = maskSecrets(text)
    expect(out).not.toContain('e4iVns7DQm34')
    expect(out).not.toContain('abcdefghijklmnop')
    expect(out.match(/•••/g)).toHaveLength(2)
    expect(out).toContain("'--admin-password'")
  })

  it('leaves everything else exactly as it was', () => {
    const text = [
      'services:',
      '  socat:',
      '    image: alpine/socat:latest',
      '    labels:',
      '      traefik.http.routers.frps-p7y-shop.rule: Host(`shop-x.lvh.me`)',
      '      sablier.group: p7y-shop',
      '    healthcheck:',
      '      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:7500/api/proxy/http"]',
    ].join('\n')
    expect(maskSecrets(text)).toBe(text)
  })
})
