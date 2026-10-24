import { describe, it, expect } from 'vitest'
import { withoutStartInterval, createStartIntervalCheck } from '../../services/healthcheckCompat'

const compose = {
  services: {
    socat: { image: 'socat', healthcheck: { test: ['CMD', 'true'], interval: '10s', retries: 12, start_period: '60s', start_interval: '500ms' } },
    frps: { image: 'frps' },
  },
}

describe('healthcheck start_interval (Docker Engine 25+)', () => {
  // Below 25 docker compose refuses the field, and the sandbox would not be created at all
  it('can be taken out of a compose file: the check then runs every 2 s throughout (a wake is not slower), nothing else changes', () => {
    const out = withoutStartInterval(compose) as typeof compose
    expect(out.services.socat.healthcheck).toEqual({ test: ['CMD', 'true'], interval: '2s', retries: 60, start_period: '60s' })
    expect(out.services.frps).toEqual({ image: 'frps' })
    expect(compose.services.socat.healthcheck.start_interval).toBe('500ms') // the runtime's own object is left alone
  })

  it('is used from API 1.44 (Engine 25) on; below, or when the version cannot be read, it is not', async () => {
    expect(await createStartIntervalCheck(async () => '1.48')()).toBe(true)
    expect(await createStartIntervalCheck(async () => '1.44')()).toBe(true)
    expect(await createStartIntervalCheck(async () => '1.43')()).toBe(false)
    expect(await createStartIntervalCheck(async () => { throw new Error('no daemon') })()).toBe(false)
  })

  it('asks the daemon once', async () => {
    let asked = 0
    const check = createStartIntervalCheck(async () => { asked++; return '1.48' })
    await check(); await check()
    expect(asked).toBe(1)
  })
})
