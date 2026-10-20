import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.stubEnv('PUBLIC_URL', 'https://p7y.example.com')
vi.mock('../../services/dockerAccess', () => ({ dockerHostName: vi.fn((n: string) => `${n.replace(/^p7y-/, '')}-docker.lvh.me`) }))
const { approveDevice, denyDevice, startDevice, _resetDevices, DEVICE_MAX_PENDING } = await import('../../services/deviceAuth')
const { default: code } = await import('../../routes/device/code/POST')
const { default: poll } = await import('../../routes/device/poll/POST')

const post = (h: (r: Request) => Promise<Response>, body?: string) => h(new Request('http://localhost/x', { method: 'POST', body }))
const ask = (b?: unknown) => post(code, b === undefined ? undefined : JSON.stringify(b))
const pollOf = (d: unknown) => post(poll, JSON.stringify({ device_code: d }))

beforeEach(() => _resetDevices())

describe('POST /device/code', () => {
  it('codes, the activate address, the timings; no-store', async () => {
    const res = await ask({ sandbox: 'shop' })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const b = await res.json()
    expect(b.verification_uri).toBe('https://p7y.example.com/activate')
    expect(b.verification_uri_complete).toBe(`https://p7y.example.com/activate?code=${b.user_code}`)
    expect(b).toMatchObject({ expires_in: 600, interval: 3 })
    expect(b.device_code).toMatch(/^[A-Za-z0-9_-]{40,}$/)
  })

  it('no body or {} is fine; a bad sandbox or body is 400', async () => {
    expect((await ask()).status).toBe(200)
    expect((await ask({})).status).toBe(200)
    expect((await ask({ sandbox: 'a'.repeat(64) })).status).toBe(400)
    expect((await ask({ sandbox: 'Shop!' })).status).toBe(400)
    expect((await ask({ sandbox: 5 })).status).toBe(400)
    expect((await post(code, 'nope')).status).toBe(400)
    expect((await ask([1])).status).toBe(400)
  })

  it('at the cap: 503', async () => {
    for (let i = 0; i < DEVICE_MAX_PENDING; i++) startDevice(null)
    const res = await ask()
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect((await res.json()).error).toMatch(/too many pending codes/)
  })
})

describe('POST /device/poll', () => {
  it('a missing or non-string device_code: 400', async () => {
    expect((await post(poll, JSON.stringify({}))).status).toBe(400)
    expect((await pollOf(5)).status).toBe(400)
    expect((await post(poll, 'nope')).status).toBe(400)
    expect((await post(poll)).status).toBe(400)
  })

  it('pending, then approved once with the link, then 410', async () => {
    const d = await (await ask({ sandbox: 'shop' })).json()
    const pending = await pollOf(d.device_code)
    expect(pending.status).toBe(200)
    expect(pending.headers.get('cache-control')).toBe('no-store')
    expect(await pending.json()).toEqual({ status: 'pending' })
    approveDevice(d.user_code, { sandbox: 'p7y-shop', owner: 'alice@example.com' })
    const ok = await pollOf(d.device_code)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toBe('no-store')
    const b = await ok.json()
    expect(b.status).toBe('approved')
    expect(b.sandbox).toBe('p7y-shop')
    expect(b.url).toMatch(/^https:\/\/p7y\.example\.com\/project-dir\/[A-Za-z0-9_-]{40,}$/)
    expect(b.command).toBe(`curl -sf "${b.url}" | tar -x -C <project folder>`)
    expect(b.context_commands).toHaveLength(2)
    const again = await pollOf(d.device_code)
    expect(again.status).toBe(410)
    expect(await again.json()).toEqual({ status: 'expired' })
  })

  it('denied; unknown code: 410', async () => {
    const d = await (await ask()).json()
    denyDevice(d.user_code)
    expect(await (await pollOf(d.device_code)).json()).toEqual({ status: 'denied' })
    expect((await pollOf('unknown')).status).toBe(410)
  })
})
