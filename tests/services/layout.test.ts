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
    setView('leander', 'advanced')
    expect(page(user)).toContain('data-mode="advanced"')
  })
  it('has the switch in the topbar, the current one pressed', () => {
    const html = page(user)
    expect(html).toMatch(/<button[^>]*data-mode-set="simple"[^>]*aria-pressed="true"/)
    expect(html).toMatch(/<button[^>]*data-mode-set="advanced"[^>]*aria-pressed="false"/)
  })
  it('marks what Simple hides: Overview, Access tokens and SSH keys in the nav', () => {
    const html = page(user)
    expect(html).toMatch(/<a class="adv" href="\/overview"/)
    expect(html).toMatch(/<a class="adv" href="\/settings\/tokens"/)
    expect(html).toMatch(/<a class="adv" href="\/settings\/ssh-keys"/)
    expect(html).toMatch(/<a class="active" href="\/"/)
  })
  it('Export for coding agents: Simple hides the token name and expiry and says what to do with the zip', () => {
    const dlg = /<dialog data-export-dialog>[\s\S]*?<\/dialog>/.exec(SANDBOX_VIEW_BODY)?.[0] ?? ''
    expect(dlg).toMatch(/<label class="adv">Token name/)
    expect(dlg).toMatch(/<label class="adv">Expires/)
    expect(dlg).toMatch(/<p class="muted simple-only"[^>]*>[^<]*Unzip it in your project/)
  })
})
