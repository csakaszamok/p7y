import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
const P = createRequire(import.meta.url)('../../ui/panel.js')

const ctx = { isAdmin: true, me: 'admin', shortName: (n: string) => n.replace(/^p7y-/, ''), tab: 'apps', protocol: 'https:', now: Date.parse('2026-10-04T15:00:00Z') }
const running = {
  name: 'p7y-shop', owner: 'admin', status: 'running', runtime: 'dind', template: 'starter', created_at: '2026-10-04 13:02:34.871 +0000 UTC',
  idle_timeout: '30m', deep_sleep_after: '7d', stops_at: '2026-10-04T15:29:56Z',
  tunnel_urls: ['shop-inner-web-port8080.lvh.me', 'shop-inner-web-port80.lvh.me', 'shop-portainer.lvh.me'],
  apps: [
    { url: 'shop-inner-web-port8080.lvh.me', port: 8080, service: 'web', answers: false },
    { url: 'shop-inner-web-port80.lvh.me', port: 80, service: 'web2', answers: true },
    { url: 'shop-portainer.lvh.me', port: 9000, service: 'portainer', answers: true },
  ],
  tcp_addresses: [
    { address: 'shop-inner-web-port80-tcp.lvh.me:443', port: 80 },
    { address: 'shop-inner-web-port8080-tcp.lvh.me:443', port: 8080 },
    { address: 'shop-inner-db-port5432-tcp.lvh.me:443', port: 5432, user: 'postgres' },
  ],
  ssh: { address: 'shop-shell-tcp.lvh.me:443', user: 'root', keys: 1, generated_key: true },
  extras: { portainer_url: 'https://shop-portainer.lvh.me', portainer_password: 'pw<1>' },
  limits: { cpus: 2, memory: 4 * 1024 ** 3 }, usage: { cpu: 0.5, memory: 1024 ** 3, memory_limit: 4 * 1024 ** 3 },
}
const panelOf = (html: string, tab: string) => {
  const m = new RegExp(`<div role="tabpanel"[^>]*data-tabpanel="${tab}"[^>]*>([\\s\\S]*?)</div><!--/${tab}-->`).exec(html)
  if (!m) throw new Error(`no tabpanel ${tab}`)
  return m[1]
}

describe('appRows', () => {
  it('puts each link with its own -tcp address (whole first label), the rest in rows of their own', () => {
    expect(P.appRows(running)).toEqual([
      { service: 'web', url: 'shop-inner-web-port8080.lvh.me', answers: false, tcp: { address: 'shop-inner-web-port8080-tcp.lvh.me:443', port: 8080 } },
      { service: 'web2', url: 'shop-inner-web-port80.lvh.me', answers: true, tcp: { address: 'shop-inner-web-port80-tcp.lvh.me:443', port: 80 } },
      { service: 'portainer', url: 'shop-portainer.lvh.me', answers: true, tcp: null },
      { service: 'shop-inner-db-port5432', url: null, answers: null, tcp: { address: 'shop-inner-db-port5432-tcp.lvh.me:443', port: 5432, user: 'postgres' } },
    ])
  })
})

describe('renderPanel', () => {
  it('a running sandbox: header buttons, sleep line with Reset, four tabs, Apps open', () => {
    const html = P.renderPanel(running, ctx)
    expect(html).toContain('data-act="terminal"')
    expect(html).toContain('data-act="stop"')
    expect(html).toContain('data-act="keep-awake"')
    expect(html).toMatch(/Sleeps in <span data-until=/)
    expect(html).toContain('role="tablist"')
    for (const [, label] of P.TABS) expect(html).toContain(`>${label}</button>`)
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*data-tab="apps"/)
    expect(html).toMatch(/data-tabpanel="access"[^>]*hidden/)
  })

  it('Apps: ✓ and ⚠ marks, the tip once, TCP with copy and Connect…', () => {
    const apps = panelOf(P.renderPanel(running, ctx), 'apps')
    expect(apps).toContain('⚠')
    expect(apps).toContain('✓')
    expect(apps).toContain('⚠ web is not answering — does it listen on 0.0.0.0 (not 127.0.0.1) inside its container?')
    expect(apps).toContain('data-copy-text="shop-inner-db-port5432-tcp.lvh.me:443"')
    expect(apps).toContain('data-connect="shop-inner-db-port5432-tcp.lvh.me:443"')
    expect(apps).toContain('data-user="postgres"')
  })

  it('Apps: several not answering, and the empty state', () => {
    const two = { ...running, apps: running.apps.map(a => ({ ...a, answers: false })) }
    expect(panelOf(P.renderPanel(two, ctx), 'apps')).toContain('⚠ web, web2, portainer are not answering — do they listen on 0.0.0.0 (not 127.0.0.1) inside their containers?')
    const none = { ...running, tunnel_urls: [], apps: [], tcp_addresses: [] }
    expect(panelOf(P.renderPanel(none, ctx), 'apps')).toContain('No apps yet — publish a port on all interfaces (e.g. 8080:8080) to get a link.')
  })

  it('Access: SSH, Portainer with a hidden password, token for the owner only', () => {
    const access = panelOf(P.renderPanel(running, ctx), 'access')
    expect(access).toContain('shop-shell-tcp.lvh.me:443')
    expect(access).toContain('Download key')
    expect(access).toContain('href="https://shop-portainer.lvh.me"')
    expect(access).toContain('<code data-secret hidden>pw&lt;1&gt;</code>')
    expect(access).toContain('data-act="token"')
    expect(panelOf(P.renderPanel(running, { ...ctx, me: 'bob' }), 'access')).not.toContain('data-act="token"')
  })

  it('Resources: now and limit with meters; Settings: owner, created, sleep, danger zone', () => {
    const html = P.renderPanel(running, ctx)
    const res = panelOf(html, 'resources')
    expect(res).toContain('data-resources')
    expect(res).toContain('0.50')
    expect(res).toContain('1 GB')
    expect(res).toContain('data-act="resources"')
    const set = panelOf(html, 'settings')
    expect(set).toContain('admin API')
    expect(set).toContain('dind · starter')
    expect(set).toContain('(1 h ago)')
    expect(set).toContain('data-act="sleep"')
    expect(set).toContain('data-act="compose"')
    expect(set).toContain('Danger zone')
    expect(set).toContain('data-act="deep-sleep"')
    expect(set).toContain('data-act="delete"')
    expect(panelOf(P.renderPanel(running, { ...ctx, isAdmin: false }), 'settings')).not.toContain('Owner')
  })

  it('asleep and deep sleep headers; a start error above the tabs', () => {
    const asleep = P.renderPanel({ ...running, status: 'exited', stops_at: null, deep_sleep_at: '2026-10-10T10:00:00Z', apps: running.apps.map(a => ({ ...a, port: null, answers: null })) }, ctx)
    expect(asleep).toContain('data-act="start"')
    expect(asleep).not.toContain('data-act="terminal"')
    expect(asleep).not.toContain('data-act="keep-awake"')
    expect(asleep).toMatch(/Deep sleep in <span data-until=[^>]*>[^<]*<\/span> · opening an app wakes it/)
    expect(panelOf(asleep, 'apps')).toContain('opening one wakes the sandbox')
    const deep = P.renderPanel({ ...running, status: 'deep_sleep' }, ctx)
    expect(deep).toContain('In deep sleep · opening an app or Wake rebuilds it')
    expect(deep).not.toContain('data-act="logs"')
    expect(panelOf(deep, 'settings')).not.toContain('data-act="deep-sleep"')
    const failed = P.renderPanel({ ...running, status: 'exited', start_error: 'boom <x>' }, ctx)
    expect(failed).toContain('class="error panel-error">boom &lt;x&gt;</p>')
    expect(P.renderPanel({ ...running, idle_timeout: 'off' }, ctx)).toContain('Never sleeps')
  })

  it('opens the remembered tab, and Apps for an unknown one', () => {
    expect(P.renderPanel(running, { ...ctx, tab: 'settings' })).toMatch(/aria-selected="true"[^>]*data-tab="settings"/)
    expect(P.renderPanel(running, { ...ctx, tab: 'nope' })).toMatch(/aria-selected="true"[^>]*data-tab="apps"/)
  })

  it('escapes names, services and addresses everywhere', () => {
    const evil = { ...running, name: 'p7y-<b>', apps: [{ url: 'x.lvh.me', port: 1, service: '<script>', answers: false }], tunnel_urls: ['x.lvh.me'], tcp_addresses: [{ address: '"onmouseover=1', port: 1 }] }
    const html = P.renderPanel(evil, ctx)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>')
    expect(html).not.toContain('"onmouseover')
  })
})

describe('review fixes', () => {
  // markBusy disables button[data-act] and button[data-connect]: every action in any tab must be such a button
  it('every action and connect control is a button', () => {
    const html = P.renderPanel({ ...running, ssh: { ...running.ssh, generated_key: false, keys: 0 } }, ctx)
    const tags = [...html.matchAll(/<(\w+)[^>]*\sdata-(?:act|connect)=/g)].map(m => m[1])
    expect(tags.length).toBeGreaterThan(10)
    expect(new Set(tags)).toEqual(new Set(['button']))
  })

  it('keeps the Portainer password when Portainer itself is private', () => {
    const access = panelOf(P.renderPanel({ ...running, tunnel_urls: running.tunnel_urls.filter(u => !u.includes('portainer')) }, ctx), 'access')
    expect(access).toContain('<code data-secret hidden>pw&lt;1&gt;</code>')
    expect(access).not.toContain('href="https://shop-portainer.lvh.me"')
  })

  it('a sandbox that failed to start is not said to wake on a visit', () => {
    const failed = P.renderPanel({ ...running, status: 'exited', start_error: 'boom', deep_sleep_at: '2026-10-10T10:00:00Z' }, ctx)
    expect(failed).not.toContain('wakes it')
  })

  it('reads well before the first request', () => {
    expect(P.renderPanel({ ...running, stops_at: null }, ctx)).toContain('Sleeps after the first request and the idle timeout')
  })
})

describe('dates', () => {
  it('reads Docker\'s created_at and says how long ago', () => {
    expect(P.parseCreated('2026-10-04 13:02:34.871 +0000 UTC')?.toISOString()).toBe('2026-10-04T13:02:34.871Z')
    expect(P.parseCreated('2026-10-04T13:02:34Z')?.toISOString()).toBe('2026-10-04T13:02:34.000Z')
    expect(P.parseCreated('nonsense')).toBeNull()
    const now = Date.parse('2026-10-04T15:00:00Z')
    expect(P.relativeAge(new Date(now - 20_000), now)).toBe('just now')
    expect(P.relativeAge(new Date(now - 5 * 60_000), now)).toBe('5 min ago')
    expect(P.relativeAge(new Date(now - 2 * 3600_000), now)).toBe('2 h ago')
    expect(P.relativeAge(new Date(now - 3 * 86400_000), now)).toBe('3 d ago')
  })
})

describe('agent access in the panel', () => {
  it('Access shows the Docker address and its state, with Enable or Export/Rotate', () => {
    const ready = panelOf(P.renderPanel({ ...running, docker_access: { host: 'shop-docker.lvh.me', state: 'ready' } }, ctx), 'access')
    expect(ready).toContain('shop-docker.lvh.me:443')
    expect(ready).toContain('data-act="export"')
    expect(ready).toContain('data-act="rotate-docker-keys"')
    const old = panelOf(P.renderPanel({ ...running, docker_access: { host: 'shop-docker.lvh.me', state: 'needs-certs' } }, ctx), 'access')
    expect(old).toContain('data-act="enable-docker"')
    expect(old).toContain('data-act="export"') // export works before Docker access too (without the keys)
    // only the owner exports (the new token is theirs)
    expect(panelOf(P.renderPanel({ ...running, docker_access: { host: 'x', state: 'ready' } }, { ...ctx, me: 'bob', isAdmin: false }), 'access')).not.toContain('data-act="export"')
  })

  it('a Registry tab: images, scan state, findings, delete', () => {
    expect(P.TABS.map(([id]: [string]) => id)).toEqual(['apps', 'access', 'resources', 'registry', 'settings'])
    expect(panelOf(P.renderPanel(running, ctx), 'registry')).toContain('data-registry')
    const html = P.registryTable({ registry: 'registry.lvh.me', public_pull: true, repos: [{ repo: 'shop/todo', versions: [
      { digest: 'sha256:aaaaaaaaaaaaaaaa', state: 'clean', tags: ['1'], pushed_at: '2026-10-04T10:00:00Z', findings: [] },
      { digest: 'sha256:bbbbbbbbbbbbbbbb', state: 'flagged', tags: ['2'], pushed_at: '2026-10-04T11:00:00Z', findings: [{ file: 'app/.env', rule: 'env-file', sample: '' }] },
    ] }] })
    expect(html).toContain('registry.lvh.me/shop/todo:1')
    expect(html).toContain('clean')
    expect(html).toContain('flagged')
    expect(html).toContain('app/.env')
    expect(html).toContain('private — not pullable without a token')
    expect(html).toContain('data-delete-app="todo" data-delete-digest="sha256:bbbbbbbbbbbbbbbb"')
    expect(P.registryTable({ registry: 'r', public_pull: true, repos: [{ repo: 'shop/ok', versions: [{ digest: 'sha256:c', state: 'clean', tags: ['1'], pushed_at: 'x', findings: [] }] }] })).toContain('public — anyone can pull')
    expect(P.registryTable({ registry: 'r', public_pull: true, repos: [] })).toContain('No images yet')
  })

  it('escapes registry data', () => {
    const html = P.registryTable({ registry: 'r', public_pull: true, repos: [{ repo: 'shop/<x>', versions: [{ digest: 'sha256:"', state: 'flagged', tags: ['<t>'], pushed_at: 'x', findings: [{ file: '<f>', rule: 'r', sample: '<s>' }] }] }] })
    expect(html).not.toMatch(/<x>|<t>|<f>|<s>/)
  })
})

describe('export band', () => {
  it('Export and Copy as .env sit at the top of Access for the owner, whatever the state', () => {
    for (const docker_access of [{ host: 'x', state: 'ready' }, { host: 'x', state: 'needs-certs' }, undefined]) {
      const access = panelOf(P.renderPanel({ ...running, docker_access }, ctx), 'access')
      expect(access.indexOf('data-act="export"')).toBeGreaterThan(-1)
      expect(access.indexOf('data-act="export"')).toBeLessThan(access.indexOf('<table'))
      expect(access).toContain('data-act="copy-env"')
    }
    const other = panelOf(P.renderPanel({ ...running, docker_access: { host: 'x', state: 'ready' } }, { ...ctx, me: 'bob', isAdmin: false }), 'access')
    expect(other).not.toContain('data-act="export"')
    expect(other).not.toContain('data-act="copy-env"')
  })
})

describe('resourcesTable: disk', () => {
  const G = 1024 ** 3
  const base = { status: 'running', limits: { cpus: 2, memory: 4 * G }, usage: { cpu: 0.5, memory: G, memory_limit: 4 * G } }
  it('shows the measured use against the limit', () => {
    const html = P.resourcesTable({ ...base, disk: { limit: 20 * G, used: 5 * G, measured_at: '2026-10-05T10:00:00Z', over: false } })
    expect(html).toContain('Disk')
    expect(html).toContain('5 GB')
    expect(html).toContain('20 GB')
    expect(html).not.toContain('Over its disk limit')
  })
  it('warns over the limit, also for an asleep sandbox; not measured yet is a dash', () => {
    const over = P.resourcesTable({ ...base, status: 'exited', disk: { limit: 20 * G, used: 30 * G, measured_at: '2026-10-05T10:00:00Z', over: true } })
    expect(over).toContain('Over its disk limit')
    expect(over).toContain('docker system prune')
    const none = P.resourcesTable({ ...base, disk: { limit: 20 * G, used: null, measured_at: null, over: false } })
    expect(none).toContain('not measured yet')
  })
})


describe('overview', () => {
  const G = 1024 ** 3
  const list = [
    { name: 'p7y-a', owner: 'u@x', status: 'running', disk: { used: 5 * G, limit: 20 * G, over: false } },
    { name: 'p7y-b', owner: 'u@x', status: 'exited', disk: { used: 25 * G, limit: 20 * G, over: true } },
    { name: 'p7y-c', owner: 'admin', status: 'deep_sleep', disk: { used: G, limit: 20 * G, over: false } },
  ]
  it("a user: their sandboxes of how many allowed, the states, their own list", () => {
    const html = P.overviewHtml({ quota: 3, archived: 4, server_full: false }, list.filter(s => s.owner === 'u@x'), { isAdmin: false })
    expect(html).not.toContain('slots used')
    expect(html).toMatch(/Running[\s\S]*?class="ov-num">1<small> \/ 3<\/small>/)
    expect(html).toContain('2 more can run')
    expect(html).toContain('not counted')
    expect(html).toMatch(/Archived[\s\S]*?class="ov-num">4</)
    expect(html).toContain('1 over its disk limit')
    expect(html).not.toContain('Per owner')
  })
  it('a user: the server limit can stop them under their own quota', () => {
    expect(P.overviewHtml({ quota: 3, archived: 0, server_full: true }, [], { isAdmin: false })).toContain('the server is full')
  })
  it("the admin: users' sandboxes against the server limit, resources, disk, owners linking to the filtered list", () => {
    const sum = { archived: 9, server_limit: 30, server_used: 2, by_owner: [{ owner: 'u@x', quota: 3, total: 2, archived: 1 }, { owner: 'admin', quota: null, total: 1, archived: 8 }],
      resources: { cpu: { used: 0.5, reserved: 2, host: 20 }, memory: { used: G, reserved: 4 * G, host: 16 * G }, disk: { used: 31 * G, over: 1 } } }
    const html = P.overviewHtml(sum, list, { isAdmin: true })
    expect(html).toContain("Users' slots used")
    expect(html).toContain('2<small> / 30</small>')
    expect(html).toContain('+ 0 of the admin, not counted') // its one sandbox sleeps deeply
    expect(html).toContain('href="/admin?status=running"')
    expect(html).toContain('Host resources')
    expect(html).toContain('0.5 of 20 cores')
    expect(html).toContain('2 cores reserved')
    expect(html).toContain('31 GB')
    expect(html).toContain('href="/admin?owner=u%40x"')
    expect(html).toContain('1 / 3</td>') // u@x: running / quota
    expect(html).toContain('∞')
  })
  it('the admin without a server limit', () => {
    expect(P.overviewHtml({ archived: 0, server_limit: null, server_used: 0, by_owner: [], resources: null }, [], { isAdmin: true })).toContain('no server limit')
  })
})

describe('overview: only running sandboxes count', () => {
  it("a user at the limit: Running 1 / 1, and asleep or deep-sleeping ones are not counted", () => {
    const list = [{ name: 'p7y-a', owner: 'u@x', status: 'running' }, { name: 'p7y-b', owner: 'u@x', status: 'deep_sleep' }, { name: 'p7y-c', owner: 'u@x', status: 'exited' }]
    const html = P.overviewHtml({ quota: 1, archived: 0, server_full: false }, list, { isAdmin: false })
    expect(html).toMatch(/Running[\s\S]*?class="ov-num">1<small> \/ 1<\/small>/)
    expect(html).toContain('limit reached: Wake lets you choose one to put to sleep')
    expect(html).toMatch(/Asleep[\s\S]*?class="ov-num">1</)
    expect(html).not.toContain('slots used')
  })
  it("the admin: users' sandboxes in deep sleep are not counted against the server limit", () => {
    const list = [{ name: 'p7y-a', owner: 'u@x', status: 'running' }, { name: 'p7y-b', owner: 'u@x', status: 'deep_sleep' }]
    expect(P.overviewHtml({ archived: 0, server_limit: 5, server_used: 1, by_owner: [], resources: null }, list, { isAdmin: true })).toContain('1<small> / 5</small>')
  })
})

describe('overview: the running limit', () => {
  it('the admin: an owner row shows running / quota', () => {
    const list = [{ name: 'p7y-a', owner: 'u@x', status: 'running' }]
    const html = P.overviewHtml({ archived: 0, server_limit: null, server_used: 1, by_owner: [{ owner: 'u@x', quota: 3, total: 1, archived: 0 }], resources: null }, list, { isAdmin: true })
    expect(html).toContain('1 / 3</td>')
  })
  it('a user: Running 1 / 3, Asleep a plain count, no slot count', () => {
    const list = [{ name: 'p7y-c03', owner: 'u@x', status: 'running' }, { name: 'p7y-c02', owner: 'u@x', status: 'exited' }, { name: 'p7y-c01', owner: 'u@x', status: 'deep_sleep' }]
    const html = P.overviewHtml({ quota: 3, archived: 0, server_full: false }, list, { isAdmin: false })
    expect(html).toMatch(/Running[\s\S]*?class="ov-num">1<small> \/ 3<\/small>/)
    expect(html).toMatch(/Asleep[\s\S]*?class="ov-num">1</)
    expect(html).not.toContain('slots used')
  })
})
