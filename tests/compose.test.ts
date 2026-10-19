import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'

const compose = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'docker-compose.yml'), 'utf8')) as {
  services: Record<string, { environment?: Record<string, string>; command?: string[] }>
}

describe('docker-compose.yml', () => {
  // The p7y service lists its environment explicitly: a setting not listed never reaches the container
  it('passes the app access settings to Purgatory', () => {
    const env = compose.services.p7y.environment ?? {}
    expect(env.APPS_ACCESS_DEFAULT).toBe('${APPS_ACCESS_DEFAULT:-public}')
    expect(env.APP_ACCESS_SECRET).toBe('${APP_ACCESS_SECRET:-}')
  })
  it('passes the sleep limits to Purgatory', () => {
    const env = compose.services.p7y.environment ?? {}
    expect(env.SANDBOX_MAX_IDLE_TIMEOUT).toBe('${SANDBOX_MAX_IDLE_TIMEOUT:-}')
    expect(env.SANDBOX_MAX_DEEP_SLEEP_AFTER).toBe('${SANDBOX_MAX_DEEP_SLEEP_AFTER:-}')
  })
  // Not on the published API port: Traefik reaches them on the internal one
  it("Traefik reads the access middlewares from Purgatory's internal port", () => {
    expect(compose.services.traefik.command).toContain('--providers.http.endpoint=http://p7y:3001/traefik/access')
  })
})

