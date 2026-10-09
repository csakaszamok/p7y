import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import yaml from 'js-yaml'

vi.mock('../../services/compose', () => ({ composeUpService: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../services/project', () => ({ nudgeTraefik: vi.fn().mockResolvedValue(undefined) }))

import { readSleepSettings, withSleepSettings, validateSleepSettings, updateSleepSettings, composeDeepSleepAfter, sleepSettingsOf, normalizeIdleTimeout, normalizeDeepSleepAfter, sessionDurationOf } from '../../services/sleepSettings'
import { composeUpService } from '../../services/compose'
import { nudgeTraefik } from '../../services/project'

const NAME = 'leander-a1'
const IDLE = `traefik.http.middlewares.sablier-${NAME}.plugin.sablier.sessionDuration`
const compose = (idle = '30m', deep = '7d') => yaml.dump({
  services: {
    sandbox: { image: 'dind', labels: { 'leander.name': NAME, 'leander.deep_sleep_after': deep } },
    frps: { image: 'frps' },
    socat: { image: 'socat', labels: { [IDLE]: idle, 'traefik.enable': 'true' } }
  }
}, { lineWidth: -1 })

function tempCompose(text = compose()): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ldr-sleep-'))
  const file = `${dir}/docker-compose.yml`
  fs.writeFileSync(file, text)
  return file
}

describe('readSleepSettings / withSleepSettings', () => {
  it('reads both values from the compose labels', () => {
    expect(readSleepSettings(compose('45m', 'off'), NAME)).toEqual({ idle_timeout: '45m', deep_sleep_after: 'off' })
  })

  it('rewrites only the given value and keeps everything else', () => {
    const out = withSleepSettings(compose(), NAME, { deep_sleep_after: '14d' })
    expect(readSleepSettings(out, NAME)).toEqual({ idle_timeout: '30m', deep_sleep_after: '14d' })
    const doc = yaml.load(out) as { services: Record<string, { image: string; labels?: Record<string, string> }> }
    expect(doc.services.socat.labels?.['traefik.enable']).toBe('true')
    expect(doc.services.frps.image).toBe('frps')
  })

  it('refuses a compose file without the sleep labels', () => {
    expect(() => withSleepSettings(yaml.dump({ services: { sandbox: {} } }), NAME, { idle_timeout: '1h' })).toThrow(/cannot be changed/)
  })
})

describe('validateSleepSettings', () => {
  it('accepts the create-time formats', () => {
    expect(validateSleepSettings({ idle_timeout: '45m', deep_sleep_after: 'off' })).toEqual({ idle_timeout: '45m', deep_sleep_after: 'off' })
    expect(validateSleepSettings({ deep_sleep_after: '12h' })).toEqual({ deep_sleep_after: '12h' })
  })

  it('rejects bad values, unknown shapes and an empty change', () => {
    expect(validateSleepSettings({ idle_timeout: '0m' })).toMatch(/idle_timeout/)
    expect(validateSleepSettings({ idle_timeout: '2d' })).toMatch(/idle_timeout/)
    expect(validateSleepSettings({ deep_sleep_after: '10s' })).toMatch(/deep_sleep_after/)
    expect(validateSleepSettings({})).toMatch(/nothing to change/)
    expect(validateSleepSettings(null)).toMatch(/JSON object/)
  })
})

describe('updateSleepSettings', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('a running sandbox: recreates and starts only socat when the sleep time changes', async () => {
    const file = tempCompose()
    const result = await updateSleepSettings(NAME, 'running', { idle_timeout: '1h' }, file, { renew: async () => {} })
    expect(result).toEqual({ idle_timeout: '1h', deep_sleep_after: '7d' })
    expect(readSleepSettings(fs.readFileSync(file, 'utf8'), NAME).idle_timeout).toBe('1h')
    expect(composeUpService).toHaveBeenCalledWith(file, 'socat', true)
    expect(nudgeTraefik).toHaveBeenCalled()
  })

  it('an asleep sandbox: recreates socat without starting it', async () => {
    const file = tempCompose()
    await updateSleepSettings(NAME, 'exited', { idle_timeout: '1h' }, file)
    expect(composeUpService).toHaveBeenCalledWith(file, 'socat', false)
  })

  it('a deep-sleeping sandbox, or only the deep sleep time: touches no container', async () => {
    await updateSleepSettings(NAME, 'deep_sleep', { idle_timeout: '1h' }, tempCompose())
    await updateSleepSettings(NAME, 'running', { deep_sleep_after: '1d' }, tempCompose())
    expect(composeUpService).not.toHaveBeenCalled()
  })

  // A running session keeps the expiry it was opened with (e.g. 10 years while sleep was off) until a request renews it
  it('a running sandbox: renews its sleep session with the new time at once', async () => {
    const renew = vi.fn(async () => {})
    await updateSleepSettings(NAME, 'running', { idle_timeout: '1h' }, tempCompose(), { renew })
    expect(renew).toHaveBeenCalledWith(NAME, '1h')
    renew.mockClear()
    await updateSleepSettings(NAME, 'exited', { idle_timeout: '2h' }, tempCompose(), { renew })
    await updateSleepSettings(NAME, 'running', { deep_sleep_after: '1d' }, tempCompose(), { renew })
    expect(renew).not.toHaveBeenCalled()
  })

  it('an unchanged sleep time touches no container', async () => {
    await updateSleepSettings(NAME, 'running', { idle_timeout: '30m' }, tempCompose())
    expect(composeUpService).not.toHaveBeenCalled()
  })
})

describe('composeDeepSleepAfter', () => {
  it('reads the value from the compose file, undefined when there is none', () => {
    expect(composeDeepSleepAfter(NAME, tempCompose(compose('30m', '3d')))).toBe('3d')
    expect(composeDeepSleepAfter(NAME, '/nonexistent/docker-compose.yml')).toBeUndefined()
  })
})

describe('sleepSettingsOf', () => {
  it('reads both settings from the compose file, {} when there is none', () => {
    expect(sleepSettingsOf(NAME, tempCompose(compose('45m', '3d')))).toEqual({ idle_timeout: '45m', deep_sleep_after: '3d' })
    expect(sleepSettingsOf(NAME, '/nonexistent/docker-compose.yml')).toEqual({})
  })
})

describe('never sleeping: 0 or off', () => {
  it('accepts 0 and off for both, normalized to off', () => {
    expect(validateSleepSettings({ idle_timeout: '0', deep_sleep_after: '0' })).toEqual({ idle_timeout: 'off', deep_sleep_after: 'off' })
    expect(validateSleepSettings({ idle_timeout: 'off' })).toEqual({ idle_timeout: 'off' })
    expect(validateSleepSettings({ idle_timeout: 0, deep_sleep_after: 0 })).toEqual({ idle_timeout: 'off', deep_sleep_after: 'off' })
  })

  it('writes an idle_timeout of off as a 10-year Sablier session and reads it back as off', () => {
    const out = withSleepSettings(compose(), NAME, { idle_timeout: 'off' })
    expect(out).toContain(`${IDLE}: 87600h`)
    expect(readSleepSettings(out, NAME).idle_timeout).toBe('off')
  })

  it('normalizers', () => {
    expect(normalizeIdleTimeout('45m')).toBe('45m')
    expect(normalizeIdleTimeout('0')).toBe('off')
    expect(normalizeIdleTimeout('0m')).toBeNull()
    expect(normalizeDeepSleepAfter('7d')).toBe('7d')
    expect(normalizeDeepSleepAfter(0)).toBe('off')
    expect(normalizeDeepSleepAfter('10s')).toBeNull()
    expect(sessionDurationOf('off')).toBe('87600h')
    expect(sessionDurationOf('30m')).toBe('30m')
  })
})
