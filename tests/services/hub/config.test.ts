import { describe, it, expect } from 'vitest'
import { hubEnabled, hubHost, hubUrl, hubTitle, isHubHost } from '../../../services/hub/config'

const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv

describe('hub config', () => {
  it('is off unless HUB_ENABLED is exactly true', () => {
    expect(hubEnabled(env({}))).toBe(false)
    expect(hubEnabled(env({ HUB_ENABLED: 'yes' }))).toBe(false)
    expect(hubEnabled(env({ HUB_ENABLED: 'true' }))).toBe(true)
  })
  it('defaults the host to hub.<HOST_DOMAIN>', () => {
    expect(hubHost(env({ HOST_DOMAIN: 'Example.com' }))).toBe('hub.example.com')
    expect(hubHost(env({ HOST_DOMAIN: 'example.com', HUB_HOST: 'Apps.Example.com' }))).toBe('apps.example.com')
  })
  it('takes the scheme from PUBLIC_URL', () => {
    expect(hubUrl(env({ HOST_DOMAIN: 'example.com', PUBLIC_URL: 'https://p7y.example.com' }))).toBe('https://hub.example.com')
    expect(hubUrl(env({ HOST_DOMAIN: 'lvh.me' }))).toBe('http://hub.lvh.me')
  })
  it('titles the page Hub by default', () => {
    expect(hubTitle(env({}))).toBe('Hub')
    expect(hubTitle(env({ HUB_TITLE: 'Example Ltd' }))).toBe('Example Ltd')
  })
  it('recognises the Hub host with a port and in any case, and nothing else', () => {
    const e = env({ HOST_DOMAIN: 'example.com' })
    expect(isHubHost('hub.example.com', e)).toBe(true)
    expect(isHubHost('HUB.example.com:443', e)).toBe(true)
    expect(isHubHost('p7y.example.com', e)).toBe(false)
    expect(isHubHost('hub.example.com.evil.io', e)).toBe(false)
    expect(isHubHost(undefined, e)).toBe(false)
  })
})
