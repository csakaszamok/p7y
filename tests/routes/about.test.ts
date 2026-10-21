import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.stubEnv('SESSION_SECRET', 'test-secret')
const about = (await import('../../routes/about/GET')).default
const login = (await import('../../routes/login/GET')).default
const { renderPage } = await import('../../services/ui/layout')
const { _resetRepoInfo } = await import('../../services/repoInfo')

const pkg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'about-')), 'package.json')
fs.writeFileSync(pkg, JSON.stringify({ version: '0.11.0' }))
const page = async () => (await about(new Request('http://p7y.lvh.me/about'))).text()

afterEach(() => { vi.unstubAllEnvs(); vi.stubEnv('SESSION_SECRET', 'test-secret'); _resetRepoInfo() })

describe('/about (AGPL-3.0 sections 5(d) and 13)', () => {
  it('needs no sign-in, and shows the license, the source of this version and the attribution', async () => {
    vi.stubEnv('P7Y_PACKAGE_JSON', pkg)
    _resetRepoInfo()
    const res = await about(new Request('http://p7y.lvh.me/about'))
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Based on Purgatory (p7y)')
    expect(html).toContain('GNU Affero General Public License')
    expect(html).toContain('href="https://github.com/p7y-dev/p7y/tree/v0.11.0"')
    expect(html).toMatch(/without any warranty/i)
  })
  it('stays Purgatory with an own name and logo: the attribution is not white-labelled', async () => {
    vi.stubEnv('UI_TITLE', 'Example Lab')
    vi.stubEnv('UI_LOGO', 'none')
    vi.stubEnv('GITHUB_LINK', 'off')
    const html = await page()
    expect(html).toContain('Based on Purgatory (p7y)')
    expect(html).toContain('https://github.com/p7y-dev/p7y')
  })
  it('an unknown version links to the repository', async () => {
    vi.stubEnv('P7Y_PACKAGE_JSON', path.join(os.tmpdir(), 'no-such-package.json'))
    _resetRepoInfo()
    expect(await page()).toContain('href="https://github.com/p7y-dev/p7y"')
  })
  it('the sign-in page and every signed-in page link to it, also with GITHUB_LINK=off and UI_TITLE=none', async () => {
    vi.stubEnv('GITHUB_LINK', 'off')
    vi.stubEnv('UI_TITLE', 'none')
    vi.stubEnv('USER_PREFS_FILE', path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-')), 'p.json'))
    expect(await (await login(new Request('http://p7y.lvh.me/login'))).text()).toMatch(/<a [^>]*href="\/about"/)
    expect(renderPage({ title: 'x', view: 'mine', session: { sub: 'anna@example.com', role: 'user', exp: 0 }, body: '' })).toMatch(/<a [^>]*href="\/about"/)
  })
})
