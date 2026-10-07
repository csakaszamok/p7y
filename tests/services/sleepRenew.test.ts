import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import yaml from 'js-yaml'

vi.mock('../../services/compose', () => ({ composeUpService: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../services/project', () => ({ nudgeTraefik: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../services/wake', () => ({ primeSablierSession: vi.fn(async () => true) }))
// First renewal still went through Traefik's old (30m) middleware; the second through the new one (40m)
vi.mock('../../services/sleepTimes', () => ({ sleepTimes: vi.fn().mockResolvedValueOnce({ stops_in: 1775 }).mockResolvedValue({ stops_in: 2399 }) }))
const { updateSleepSettings } = await import('../../services/sleepSettings')
const { primeSablierSession } = await import('../../services/wake')

const NAME = 'leander-a1'
const IDLE = `traefik.http.middlewares.sablier-${NAME}.plugin.sablier.sessionDuration`
function tempCompose(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-renew-'))
  const file = path.join(dir, 'docker-compose.yml')
  fs.writeFileSync(file, yaml.dump({ services: {
    sandbox: { image: 'dind', labels: { 'leander.name': NAME, 'leander.deep_sleep_after': '7d' } },
    socat: { image: 'socat', labels: { [IDLE]: '30m', 'traefik.enable': 'true' } },
  } }, { lineWidth: -1 }))
  return file
}

describe('renewing the sleep session after a change', () => {
  // 30m → 40m: a session still at ~30 minutes is the old one, not "short enough"
  it('renews until the countdown is close to the new time, also when the new time is longer', async () => {
    await updateSleepSettings(NAME, 'running', { idle_timeout: '40m' }, tempCompose())
    expect(primeSablierSession).toHaveBeenCalledTimes(2)
  }, 10_000)
})
