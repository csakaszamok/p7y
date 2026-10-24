import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { renderPage, SANDBOX_VIEW_BODY } from '../../services/ui/layout'
import { setView } from '../../services/userPrefs'

const user = { sub: 'leander', role: 'user' as const, exp: 0 }
const admin = { sub: 'root', role: 'admin' as const, exp: 0 }
const page = (session: typeof user | typeof admin) => renderPage({ title: 'x', view: 'mine', session, body: '' })

describe('renderPage: Simple / Advanced', () => {
  beforeEach(() => {
    vi.stubEnv('USER_PREFS_FILE', path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-')), 'user-prefs.json'))
    vi.stubEnv('GITHUB_STATS', 'off')
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('a user starts in Simple, the admin in Advanced', () => {
    expect(page(user)).toContain('data-mode="simple"')
    expect(page(admin)).toContain('data-mode="advanced"')
  })
  it('follows the choice saved for the account', () => {
    vi.stubEnv('USER_VIEW_SWITCH', 'true')
    setView('leander', 'advanced')
    expect(page(user)).toContain('data-mode="advanced"')
  })
  it('has the switch in the topbar, the current one pressed', () => {
    vi.stubEnv('USER_VIEW_SWITCH', 'true')
    const html = page(user)
    expect(html).toMatch(/<button[^>]*data-mode-set="simple"[^>]*aria-pressed="true"/)
    expect(html).toMatch(/<button[^>]*data-mode-set="advanced"[^>]*aria-pressed="false"/)
  })
  it('without USER_VIEW_SWITCH=true: a user is in Simple with no switch, whatever they chose; the admin keeps it', () => {
    setView('leander', 'advanced')
    const html = page(user)
    expect(html).toContain('data-mode="simple"')
    expect(html).not.toContain('data-mode-set')
    expect(html).not.toContain('class="mode-switch"')
    expect(page(admin)).toMatch(/<button[^>]*data-mode-set="advanced"[^>]*aria-pressed="true"/)
  })
  it('marks what Simple hides: Overview, Access tokens and SSH keys in the nav', () => {
    const html = page(user)
    expect(html).toMatch(/<a class="adv" href="\/overview"/)
    expect(html).toMatch(/<a class="adv" href="\/settings\/tokens"/)
    expect(html).toMatch(/<a class="adv" href="\/settings\/ssh-keys"/)
    expect(html).toMatch(/<a class="active" href="\/"/)
  })
  describe('Let your agent deploy (the same window in both views)', () => {
    const dlg = /<dialog data-export-dialog>[\s\S]*?<\/dialog>/.exec(SANDBOX_VIEW_BODY)?.[0] ?? ''
    // Not simple-only: Advanced shows the same two ways
    const claude = /<section class="agent-way" data-way="claude">[\s\S]*?<\/section>/.exec(dlg)?.[0] ?? ''
    const other = /<section class="agent-way" data-way="other">[\s\S]*?<\/section>/.exec(dlg)?.[0] ?? ''
    const options = /<details class="adv export-options">[\s\S]*?<\/details>/.exec(dlg)?.[0] ?? ''

    it('one title for both views', () => {
      expect(dlg).toContain('<h2>Let your agent deploy</h2>')
      expect(dlg).not.toContain('Export for coding agents</h2>')
    })
    it('Advanced only: Options with the token name, expiry, no Docker keys and Copy as .env', () => {
      expect(options).toContain('<label>Token name<input name="name"')
      expect(options).toContain('<label>Expires<select name="expires_in"')
      expect(options).toMatch(/<input type="checkbox" name="no_docker"/)
      expect(options).toMatch(/<button type="button"[^>]*data-copy-env[^>]*>Copy as \.env<\/button>/)
    })
    it('Claude Code: install the plugin once, then the init line to copy', () => {
      expect(claude).toContain('claude plugin install p7y@p7y')
      expect(claude).not.toContain('--config')
      expect(claude).not.toContain('data-plugin-token')
      expect(claude).toMatch(/data-init-cmd/)
      expect(claude).toMatch(/<button type="button"[^>]*data-copy-from="\[data-init-cmd\]"[^>]*>Copy<\/button>/)
      expect(claude).toContain('approve in the browser page it opens')
    })
    it('Claude Code, in Claude Code instead: the /plugin commands', () => {
      const other = /<details[^>]*>[\s\S]*?<\/details>/.exec(claude)?.[0] ?? ''
      expect(other).toContain('<code>/plugin marketplace add csakaszamok/p7y</code>')
      expect(other).toContain('<code>/plugin install p7y@p7y</code>')
    })
    it('the zip keeps its Download button', () => {
      expect(dlg).toMatch(/<button class="primary" value="download" data-export-download>Download<\/button>/)
    })
    it('other agents: the zip, unpacked by the agent', () => {
      expect(other).toContain('set up the p7y zip from my Downloads in this project and deploy')
    })
  })
})

describe('sleep settings fields', () => {
  // Both the New sandbox form and the Sleep settings dialog
  const patterns = [...SANDBOX_VIEW_BODY.matchAll(/<input name="idle_timeout"[^>]*pattern="([^"]+)"/g)].map(m => new RegExp(`^(?:${m[1]})$`))
  it('Sleep after no traffic takes days too', () => {
    expect(patterns.length).toBe(2)
    for (const p of patterns) {
      for (const ok of ['30m', '2h', '1d', '0', 'off']) expect(p.test(ok), ok).toBe(true)
      for (const bad of ['0m', '1.5d', '1w']) expect(p.test(bad), bad).toBe(false)
    }
  })
})
