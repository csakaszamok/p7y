import { describe, it, expect } from 'vitest'
import { userHost, isUserHost, userUrl, requestUrl, onAdminHost } from '../../services/userHost'
import { ownHostTaken } from '../../services/uiHost'

const on = { HOST_DOMAIN: 'p9m.dev', UI_HOST: 'console.p9m.dev', PUBLIC_URL: 'https://console.p9m.dev', USER_HOST: ' SBX.p9m.dev ' } as NodeJS.ProcessEnv
const off = { HOST_DOMAIN: 'p9m.dev', UI_HOST: 'console.p9m.dev', PUBLIC_URL: 'https://console.p9m.dev' } as NodeJS.ProcessEnv
const req = (host: string) => new Request('http://localhost/', { headers: { host } })

describe('USER_HOST', () => {
  it('off when empty or the same as UI_HOST: everyone on PUBLIC_URL, as before', () => {
    for (const env of [off, { ...off, USER_HOST: '' }, { ...off, USER_HOST: 'Console.p9m.dev' }]) {
      expect(userHost(env)).toBeNull()
      expect(userUrl(env)).toBe('https://console.p9m.dev')
      expect(requestUrl(req('console.p9m.dev'), env)).toBe('https://console.p9m.dev')
      expect(onAdminHost(req('console.p9m.dev'), env)).toBe(false)
    }
  })
  it('on: the users\' address over PUBLIC_URL\'s scheme; the host by its Host header, port and case ignored', () => {
    expect(userHost(on)).toBe('sbx.p9m.dev')
    expect(userUrl(on)).toBe('https://sbx.p9m.dev')
    expect(userUrl({ ...on, PUBLIC_URL: 'http://console.p9m.dev/' })).toBe('http://sbx.p9m.dev')
    expect(isUserHost('SBX.p9m.dev:443', on)).toBe(true)
    expect(isUserHost('console.p9m.dev', on)).toBe(false)
    expect(isUserHost(null, on)).toBe(false)
  })
  it('requestUrl: the address the request came to; onAdminHost: anything but USER_HOST', () => {
    expect(requestUrl(req('sbx.p9m.dev'), on)).toBe('https://sbx.p9m.dev')
    expect(requestUrl(req('console.p9m.dev'), on)).toBe('https://console.p9m.dev')
    expect(onAdminHost(req('console.p9m.dev'), on)).toBe(true)
    expect(onAdminHost(req('sbx.p9m.dev'), on)).toBe(false)
  })
  it('a sandbox may not take it: sbx-<x>.<domain> would not, but a USER_HOST of sbx-users.<domain> would', () => {
    expect(ownHostTaken('sbx', on)).toBeNull()
    expect(ownHostTaken('sbx', { ...on, USER_HOST: 'sbx-users.p9m.dev' })).toBe('sbx-users.p9m.dev')
  })
})
