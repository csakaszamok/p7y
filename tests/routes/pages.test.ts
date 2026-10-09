import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('SESSION_SECRET', 'test-secret')
vi.mock('../../services/sandbox', () => ({
  sandboxService: {
    getSandbox: vi.fn(async (n: string) => {
      if (n !== 'p7y-mine') throw new Error(`Sandbox not found: ${n}`)
      return { name: n, owner: 'alice@example.com' }
    }),
  },
}))
vi.stubEnv('OIDC_ISSUER', 'https://accounts.example.com')
vi.stubEnv('OIDC_CLIENT_ID', 'cid')
vi.stubEnv('OIDC_CLIENT_SECRET', 'cs')
vi.stubEnv('OIDC_PROVIDER_NAME', 'Google')

const { createSession } = await import('../../services/session')
const index = (await import('../../routes/index/GET')).default
const admin = (await import('../../routes/admin/GET')).default
const tokens = (await import('../../routes/settings/tokens/GET')).default
const sshKeys = (await import('../../routes/settings/ssh-keys/GET')).default
const login = (await import('../../routes/login/GET')).default
const asset = (await import('../../routes/assets/[file]/GET')).default
const terminalPage = (await import('../../routes/sandboxes/[name]/terminal/GET')).default
const logsPage = (await import('../../routes/sandboxes/[name]/logs/GET')).default

const as = (sub: string, role: 'user' | 'admin') => ({ cookie: `p7y_session=${createSession(sub, role)}` })
const r = (p: string, headers: Record<string, string> = {}) => new Request(`http://p7y.lvh.me${p}`, { headers })

describe('pages', () => {
  it('redirects to /login without a session', async () => {
    for (const handler of [index, admin, tokens]) {
      const res = await handler(r('/x'))
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/login')
    }
  })

  it('renders My sandboxes with navigation for a user, without the admin link', async () => {
    const res = await index(r('/', as('alice@example.com', 'user')))
    const html = await res.text()
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    expect(html).toContain('data-view="mine"')
    expect(html).toContain('alice@example.com')
    expect(html).not.toContain('href="/admin"')
    expect(html).toContain('<script src="/assets/app.js"')
  })

  it('offers the new token as a .env for an agent, on My sandboxes and Access tokens', async () => {
    for (const res of [await index(r('/', as('alice@example.com', 'user'))), await tokens(r('/settings/tokens', as('alice@example.com', 'user')))]) {
      const html = await res.text()
      expect(html).toContain('data-download-env')
      expect(html).toContain('data-export-dialog')
      expect(html).toContain('keep it out of git')
    }
  })

  it('keeps non-admins out of the admin page', async () => {
    const res = await admin(r('/admin', as('alice@example.com', 'user')))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/')
    const ok = await admin(r('/admin', as('admin', 'admin')))
    expect(await ok.text()).toContain('data-view="all"')
  })

  it('renders the terminal page for the owner only, loading xterm from our own assets', async () => {
    const page = await terminalPage(r('/sandboxes/p7y-mine/terminal', as('alice@example.com', 'user')))
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('/assets/xterm.js')
    expect(html).toContain('/assets/terminal.js')
    expect(html).toContain('data-sandbox="p7y-mine"')
    expect((await terminalPage(r('/sandboxes/p7y-other/terminal', as('alice@example.com', 'user')))).status).toBe(404)
    expect((await terminalPage(r('/sandboxes/p7y-mine/terminal'))).status).toBe(302)
  })

  // A sandbox's app on another *.<domain> is same-site: it could frame our pages (the terminal above all)
  it('forbids framing of every page', async () => {
    for (const res of [
      await terminalPage(r('/sandboxes/p7y-mine/terminal', as('alice@example.com', 'user'))),
      await index(r('/', as('alice@example.com', 'user'))),
      await login(r('/login')),
    ]) {
      expect(res.headers.get('x-frame-options')).toBe('DENY')
      expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'")
    }
  })

  it('renders the logs page for the owner only', async () => {
    const page = await logsPage(r('/sandboxes/p7y-mine/logs', as('alice@example.com', 'user')))
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('/assets/logs.js')
    expect(html).toContain('data-sandbox="p7y-mine"')
    expect(page.headers.get('x-frame-options')).toBe('DENY')
    expect((await logsPage(r('/sandboxes/p7y-other/logs', as('alice@example.com', 'user')))).status).toBe(404)
    expect((await logsPage(r('/sandboxes/p7y-mine/logs'))).status).toBe(302)
  })

  it('loads the panel script before app.js and serves it', async () => {
    const html = await (await index(r('/', as('alice@example.com', 'user')))).text()
    expect(html.indexOf('/assets/panel.js')).toBeGreaterThan(-1)
    expect(html.indexOf('/assets/panel.js')).toBeLessThan(html.indexOf('/assets/app.js'))
    expect((await asset(r('/assets/panel.js'))).status).toBe(200)
  })

  it('serves the logs script', async () => {
    expect((await asset(r('/assets/logs.js'))).status).toBe(200)
  })

  it('serves the vendored xterm files and the terminal script', async () => {
    for (const f of ['xterm.js', 'xterm.css', 'addon-fit.js', 'terminal.js']) expect((await asset(r(`/assets/${f}`))).status, f).toBe(200)
  })

  it('renders the SSH keys page, linked from the header', async () => {
    const page = await (await sshKeys(r('/settings/ssh-keys', as('alice@example.com', 'user')))).text()
    expect(page).toContain('data-view="ssh-keys"')
    expect(page).toContain('data-ssh-key-form')
    expect(page).toContain('data-confirm-dialog')
    const home = await (await index(r('/', as('alice@example.com', 'user')))).text()
    expect(home).toContain('href="/settings/ssh-keys"')
    expect(home).toContain('name="ssh_keys"')
  })

  it('renders the tokens page', async () => {
    expect(await (await tokens(r('/settings/tokens', as('alice@example.com', 'user')))).text()).toContain('data-view="tokens"')
  })

  it('offers a token limited to one sandbox, on the tokens page and next to a sandbox', async () => {
    const tokensPage = await (await tokens(r('/settings/tokens', as('alice@example.com', 'user')))).text()
    expect(tokensPage).toContain('name="sandbox"')
    expect(tokensPage).toContain('Bearer p7y_')
    const home = await (await index(r('/', as('alice@example.com', 'user')))).text()
    expect(home).toContain('data-token-dialog')
  })

  // The browser's confirm() can be switched off ("prevent this page from creating additional
  // dialogs") or missing (embedded browsers): it then answers Cancel at once and Archive / Revoke
  // silently do nothing. Both pages ask with their own <dialog> instead.
  it('asks for confirmation with its own dialog, never the browser confirm()', async () => {
    const home = await (await index(r('/', as('alice@example.com', 'user')))).text()
    const tokensPage = await (await tokens(r('/settings/tokens', as('alice@example.com', 'user')))).text()
    for (const page of [home, tokensPage]) expect(page).toContain('data-confirm-dialog')
    const js = await (await asset(r('/assets/app.js'))).text()
    expect(js).not.toMatch(/(^|[^.\w])confirm\(/m)
  })

  it('login page shows the provider button and an escaped error', async () => {
    const html = await (await login(r('/login?error=%3Cb%3Ebad%3C%2Fb%3E'))).text()
    expect(html).toContain('Sign in with Google')
    expect(html).toContain('&lt;b&gt;bad&lt;/b&gt;')
    expect(html).not.toContain('<b>bad</b>')
  })

  it('shows the logo: favicon on every page, next to the name in the top bar', async () => {
    const home = await (await index(r('/', as('alice@example.com', 'user')))).text()
    expect(home).toContain('<link rel="icon" href="/assets/logo.svg" type="image/svg+xml">')
    expect(home).toMatch(/class="brand"><img src="\/assets\/logo.svg"/)
    const loginPage = await (await login(r('/login'))).text()
    expect(loginPage).toContain('<link rel="icon" href="/assets/logo.svg" type="image/svg+xml">')
  })

  it('the sign-in page shows the sandbox places above the sign-in buttons', async () => {
    const { loginCapacity } = await import('../../services/loginCapacity')
    vi.spyOn(loginCapacity, 'get').mockResolvedValueOnce({ used: 143, limit: 200 })
    const page = await (await login(r('/login'))).text()
    expect(page).toContain('Sandbox places: 143 taken · 57 free')
    expect(page.indexOf('class="capacity')).toBeLessThan(page.indexOf('Sign in with Google'))
  })

  // Counting needs Docker; without it (here: no listSandboxes) the page still comes, without the line
  it('the sign-in page without the sandbox places when they cannot be counted', async () => {
    const page = await (await login(r('/login'))).text()
    expect(page).toContain('Sign in with Google')
    expect(page).not.toContain('class="capacity')
  })

  it('the sign-in page has the ember background', async () => {
    const loginPage = await (await login(r('/login'))).text()
    expect(loginPage).toContain('<script src="/assets/embers.js" defer></script>')
  })

  it('the sandbox page has the compose viewer', async () => {
    const home = await (await index(r('/', as('alice@example.com', 'user')))).text()
    expect(home).toContain('data-compose-dialog')
    expect(home).not.toContain('data-compose-tab')
  })

  it('the sandbox page has the TCP connect dialog', async () => {
    const home = await (await index(r('/', as('alice@example.com', 'user')))).text()
    expect(home).toContain('data-connect-dialog')
    expect(home).toContain('data-runtimes')
    expect(home).toContain('data-compose-editor')
    expect(home).toContain('data-resource-dialog')
    expect(home).toContain('name="cpus"')
    expect(home).toContain('name="memory"')
    expect(home).toContain('name="runtime"')
  })

  it('serves only the known assets', async () => {
    const js = await asset(r('/assets/app.js'))
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toMatch(/javascript/)
    expect((await asset(r('/assets/style.css'))).headers.get('content-type')).toMatch(/text\/css/)
    expect((await asset(r('/assets/secret.env'))).status).toBe(404)
  })

  it('serves the ember animation, the waiting-page poller and the logo', async () => {
    for (const f of ['embers.js', 'waiting.js']) {
      const res = await asset(r(`/assets/${f}`))
      expect(res.status, f).toBe(200)
      expect(res.headers.get('content-type'), f).toMatch(/javascript/)
    }
    const logo = await asset(r('/assets/logo.svg'))
    expect(logo.status).toBe(200)
    expect(logo.headers.get('content-type')).toMatch(/image\/svg\+xml/)
    expect(await logo.text()).toContain('<svg')
  })
})
