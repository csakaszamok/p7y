import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import { repoInfo, statsEnabled, _settled, _resetRepoInfo } from '../../services/repoInfo'
import { repoBadge, shortCount } from '../../services/ui/layout'

const github = (body: unknown, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 403, json: async () => body }) as Response)

beforeEach(() => {
  _resetRepoInfo()
  vi.stubEnv('GITHUB_STATS', 'on')
  vi.stubEnv('P7Y_PACKAGE_JSON', path.join(__dirname, '..', '..', 'package.json'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('repoInfo', () => {
  it('the version from package.json; the counts once GitHub answered, then cached for an hour', async () => {
    const f = github({ stargazers_count: 42, forks_count: 7 })
    vi.stubGlobal('fetch', f)
    const first = repoInfo()
    expect(first).toMatchObject({ repo: 'csakaszamok/p7y', url: 'https://github.com/csakaszamok/p7y', stars: null, forks: null })
    expect(first.version).toMatch(/^\d+\.\d+\.\d+/)
    await _settled()
    expect(repoInfo()).toMatchObject({ stars: 42, forks: 7 })
    expect(f).toHaveBeenCalledTimes(1)
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe('https://api.github.com/repos/csakaszamok/p7y')
    repoInfo(Date.now() + 30 * 60_000)
    expect(f).toHaveBeenCalledTimes(1)
    repoInfo(Date.now() + 61 * 60_000)
    await _settled()
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('GitHub failing: no counts, no error, asked again after 10 minutes', async () => {
    const f = github({ message: 'rate limited' }, false)
    vi.stubGlobal('fetch', f)
    repoInfo(); await _settled()
    expect(repoInfo()).toMatchObject({ stars: null, forks: null })
    expect(f).toHaveBeenCalledTimes(1)
    repoInfo(Date.now() + 11 * 60_000); await _settled()
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('GITHUB_STATS=off: never asks GitHub, the link and version stay', async () => {
    vi.stubEnv('GITHUB_STATS', 'off')
    const f = github({ stargazers_count: 1, forks_count: 1 })
    vi.stubGlobal('fetch', f)
    const info = repoInfo(); await _settled()
    expect(f).not.toHaveBeenCalled()
    expect(info.version).not.toBeNull()
    expect(statsEnabled({ GITHUB_STATS: ' OFF ' })).toBe(false)
    expect(statsEnabled({})).toBe(true)
  })

  it('no package.json: no version', () => {
    vi.stubEnv('GITHUB_STATS', 'off')
    vi.stubEnv('P7Y_PACKAGE_JSON', path.join(__dirname, 'missing.json'))
    expect(repoInfo().version).toBeNull()
  })
})

describe('repoBadge', () => {
  it('links to the repo with stars, forks and version', () => {
    const html = repoBadge({ repo: 'csakaszamok/p7y', url: 'https://github.com/csakaszamok/p7y', version: '0.3.0', stars: 1234, forks: 5 })
    expect(html).toContain('href="https://github.com/csakaszamok/p7y"')
    expect(html).toContain('rel="noopener"')
    expect(html).toContain('title="1234 stars"')
    expect(html).toContain('1.2k')
    expect(html).toContain('title="5 forks"')
    expect(html).toContain('v0.3.0')
  })
  it('before the counts (or with GITHUB_STATS=off): only the name and the version', () => {
    const html = repoBadge({ repo: 'csakaszamok/p7y', url: 'https://github.com/csakaszamok/p7y', version: '0.3.0', stars: null, forks: null })
    expect(html).not.toContain('stars')
    expect(html).toContain('v0.3.0')
  })
  it('shortCount', () => {
    expect([0, 999, 1000, 1234, 9999, 12345].map(shortCount)).toEqual(['0', '999', '1k', '1.2k', '10k', '12k'])
  })
})
