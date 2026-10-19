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

  it('reads well before the idle countdown starts', () => {
    expect(P.renderPanel({ ...running, stops_at: null }, ctx)).toContain('The idle countdown has not started yet')
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

  it('Access says a sleeping sandbox must be woken before docker connects', () => {
    const hint = 'Asleep: a Docker connection does not wake it. Start it first (POST /sandboxes/p7y-shop/start).'
    expect(panelOf(P.renderPanel({ ...running, status: 'exited', docker_access: { host: 'x', state: 'ready', hint } }, ctx), 'access')).toContain('a Docker connection does not wake it')
    expect(panelOf(P.renderPanel({ ...running, docker_access: { host: 'x', state: 'ready' } }, ctx), 'access')).not.toContain('does not wake it')
  })

  it('a Registry tab: images, scan state, findings, delete', () => {
    expect(P.TABS.map(([id]: [string]) => id)).toEqual(['apps', 'access', 'files', 'resources', 'registry', 'settings'])
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
    expect(html).toContain('Sandbox places used')
    expect(html).toContain('1<small> / 30</small>') // only the running one: asleep and deep sleep take no place
    expect(html).toContain('29 free')
    expect(html).not.toContain('of the admin, not counted')
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
  it("the admin's running sandbox takes a place too: 1 / 200", () => {
    const list = [{ name: 'p7y-r', owner: 'admin', status: 'running' }]
    const html = P.overviewHtml({ archived: 0, server_limit: 200, server_used: 1, by_owner: [], resources: null }, list, { isAdmin: true })
    expect(html).toContain('1<small> / 200</small>')
    expect(html).toContain('199 free')
    expect(html).toContain("1 of them the admin's")
  })
  // The bar under the cards read as "half the places taken" with 1 running and 1 asleep of 200
  it('the admin: the bar is the running sandboxes against the server limit, with the free places in the legend', () => {
    const list = [{ name: 'p7y-r', owner: 'admin', status: 'running' }, { name: 'p7y-s', owner: 'u@x', status: 'exited' }, { name: 'p7y-d', owner: 'u@x', status: 'deep_sleep' }]
    const html = P.overviewHtml({ archived: 0, server_limit: 200, server_used: 1, by_owner: [], resources: null }, list, { isAdmin: true })
    const stack = /<div class="ov-stack">[\s\S]*?<\/div>/.exec(html)?.[0] ?? ''
    expect(stack).toContain('class="r" style="width:0.5%"')
    expect(stack).not.toContain('class="a"') // asleep takes no place
    expect(stack).not.toContain('class="d"')
    expect(html).toContain('199 free of 200 places')
    expect(html).toContain('1 asleep')
  })
  it('the admin: asleep sandboxes take no place (letting them sleep frees it): 1 running of 19 is 1 / 200', () => {
    const list = [{ name: 'p7y-r', owner: 'admin', status: 'running' }, ...Array.from({ length: 18 }, (_, i) => ({ name: `p7y-s${i}`, owner: 'u@x', status: 'exited' }))]
    const html = P.overviewHtml({ archived: 0, server_limit: 200, server_used: 1, by_owner: [], resources: null }, list, { isAdmin: true })
    expect(html).toMatch(/Sandbox places used[\s\S]*?1<small> \/ 200<\/small>/)
    expect(html).toContain('199 free')
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

describe('placesBadge: the server places in the topbar', () => {
  it('taken / limit, the free ones in the title; orange from 90%, red when full; nothing without a limit', () => {
    const b = P.placesBadge({ used: 142, limit: 200 })
    expect(b.text).toBe('142 / 200 places')
    expect(b.title).toBe('Sandbox places on the server: 142 taken, 58 free (running and asleep sandboxes; deep sleep holds none)')
    expect(b.state).toBe('')
    expect(P.placesBadge({ used: 180, limit: 200 }).state).toBe('warn')
    expect(P.placesBadge({ used: 200, limit: 200 }).state).toBe('full')
    expect(P.placesBadge({ used: 203, limit: 200 }).title).toContain('0 free')
    expect(P.placesBadge(null)).toBeNull()
  })
})

// SANDBOX_QUOTA is guaranteed, SANDBOX_QUOTA_MAX (max_running) the most while the server has room
describe('the guarantee and the maximum', () => {
  const mine = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `p7y-${i}`, owner: 'u@x', status: 'running' }))
  it('a user under the guarantee: how many more are guaranteed, and how far they may go', () => {
    const html = P.overviewHtml({ quota: 3, max_running: 10, archived: 0, server_full: false }, mine(1), { isAdmin: false })
    expect(html).toMatch(/Running[\s\S]*?class="ov-num">1<small> \/ 3<\/small>/)
    expect(html).toContain('2 more guaranteed · up to 10 while the server has room')
  })
  it('a user above the guarantee, and at the maximum', () => {
    expect(P.overviewHtml({ quota: 3, max_running: 10, archived: 0, server_full: false }, mine(4), { isAdmin: false })).toContain('above the 3 guaranteed · up to 10 while the server has room')
    expect(P.overviewHtml({ quota: 3, max_running: 10, archived: 0, server_full: false }, mine(10), { isAdmin: false })).toContain('limit reached')
  })
  it('without a maximum above the guarantee nothing changes', () => {
    expect(P.overviewHtml({ quota: 3, max_running: 3, archived: 0, server_full: false }, mine(1), { isAdmin: false })).toContain('2 more can run')
  })
  it("the admin's owner table: running / guarantee (+ the extra)", () => {
    const html = P.overviewHtml({ archived: 0, server_limit: 200, server_used: 4, by_owner: [{ owner: 'u@x', quota: 3, max_running: 10, total: 4, archived: 0 }], resources: null }, mine(4), { isAdmin: true })
    expect(html).toContain('4 / 3 (+7)</td>')
  })
  it('quotaLine: the line on My sandboxes', () => {
    // short, beside the New sandbox button; the rest on hover
    expect(P.quotaLine({ quota: 3, max_running: 3, sandbox_count: 1 })).toEqual({ text: 'Running 1 / 3', title: '' })
    expect(P.quotaLine({ quota: 3, max_running: 10, sandbox_count: 4 })).toEqual({ text: 'Running 4 / 3 · up to 10', title: '3 running sandboxes guaranteed; up to 10 while the server has room' })
    expect(P.quotaLine({ quota: 3, max_running: null, sandbox_count: 4 })).toEqual({ text: 'Running 4 / 3 · more', title: '3 running sandboxes guaranteed; more while the server has room' })
  })
})

// Two running of two read as full, with one more allowed
describe("overview: a user's bar", () => {
  it('is scaled to their running limit, not to the sandboxes they have', () => {
    const list = [{ name: 'p7y-a', owner: 'u@x', status: 'running' }, { name: 'p7y-b', owner: 'u@x', status: 'running' }]
    const html = P.overviewHtml({ quota: 3, max_running: 4, archived: 0, server_full: false }, list, { isAdmin: false })
    expect(/<div class="ov-stack">[\s\S]*?<\/div>/.exec(html)?.[0] ?? '').toContain('class="r" style="width:50.0%"')
  })
  it('with more sandboxes than the limit, or no limit, it is the split of the list', () => {
    const list = [{ name: 'p7y-a', owner: 'u@x', status: 'running' }, { name: 'p7y-b', owner: 'u@x', status: 'exited' }, { name: 'p7y-c', owner: 'u@x', status: 'exited' }]
    expect(P.overviewHtml({ quota: 2, max_running: 2, archived: 0, server_full: false }, list, { isAdmin: false })).toContain('class="r" style="width:33.3%"')
    expect(P.overviewHtml({ quota: null, max_running: null, archived: 0, server_full: false }, list, { isAdmin: false })).toContain('class="r" style="width:33.3%"')
  })
})

describe('the Files tab', () => {
  const listing = { path: '/root/app', roots: ['/root', '/home', '/srv', '/opt'], max_upload: 100 * 1024 ** 2, entries: [
    { name: 'src', type: 'dir', size: 4096, mtime: '2026-10-04T14:00:00.000Z' },
    { name: 'notes <b>.md', type: 'file', size: 2048, mtime: '2026-10-04T14:58:00.000Z' },
    { name: 'latest', type: 'link', size: 7, mtime: '2026-10-04T14:00:00.000Z' },
  ] }
  it('is a tab; a running sandbox loads its files, a sleeping one offers to wake it', () => {
    expect(P.TABS.map(([id]: string[]) => id)).toEqual(['apps', 'access', 'files', 'resources', 'registry', 'settings'])
    expect(P.renderPanel(running, { ...ctx, tab: 'files' })).toContain('data-files')
    const asleep = P.renderPanel({ ...running, status: 'exited' }, { ...ctx, tab: 'files' })
    expect(asleep).toContain('wake it to see its files')
    expect(asleep).toContain('data-act="start"')
  })
  it('the four folders, the path to click back along, folders to open, files to download', () => {
    const html = P.filesView(listing, { ...ctx, name: 'p7y-shop' })
    expect(html).toContain('data-files-path="/srv"')
    expect(html).toContain('data-files-path="/root"') // the crumb back to /root
    expect(html).toContain('data-files-path="/root/app/src"')
    expect(html).toContain('href="/sandboxes/p7y-shop/files/content?path=%2Froot%2Fapp%2Fnotes%20%3Cb%3E.md"')
    expect(html).toContain('notes &lt;b&gt;.md')
    expect(html).not.toContain('notes <b>')
    expect(html).toContain('2 KB')
    expect(html).toContain('data-files-delete="/root/app/notes &lt;b&gt;.md"')
    expect(html).toContain('data-files-input')
    expect(html).toContain('up to 100 MB a file')
    expect(html).toContain('href="/sandboxes/p7y-shop/files/content?path=%2Froot%2Fapp"') // the folder as a tar
  })
  it('an empty folder says where files can go', () => {
    expect(P.filesView({ ...listing, entries: [] }, { ...ctx, name: 'p7y-shop' })).toContain('Empty: drop files here')
  })
  const vol = { name: 'shop_db', path: '/var/lib/docker/volumes/shop_db/_data', project: 'shop', containers: [{ name: 'shop-db-1', service: 'db', running: true, mount: '/var/lib/postgresql/data' }] }
  it('a Volumes chip next to the four folders', () => {
    const html = P.filesView(listing, { ...ctx, name: 'p7y-shop' })
    expect(html).toContain('data-files-volumes')
    expect(html).not.toMatch(/files-root on[^>]*data-files-volumes/)
  })
  it('in a volume: the crumbs start at the volume, a running app using it is a warning', () => {
    const html = P.filesView({ ...listing, path: `${vol.path}/base` }, { ...ctx, name: 'p7y-shop', volume: vol })
    expect(html).toMatch(/files-root on[^>]*data-files-volumes/)
    expect(html).toContain(`data-files-path="${vol.path}">shop_db</button> / <button class="link" data-files-path="${vol.path}/base">base</button>`)
    expect(html).toContain('db (shop-db-1) is running')
    expect(html).not.toContain('Only /root, /home, /srv and /opt are shown')
    const stopped = P.filesView({ ...listing, path: vol.path }, { ...ctx, name: 'p7y-shop', volume: { ...vol, containers: [{ ...vol.containers[0], running: false }] } })
    expect(stopped).not.toContain('is running')
  })
  it('a container named as its service is named once', () => {
    const solo = { ...vol, containers: [{ name: 'portainer', service: 'portainer', running: true, mount: '/data' }] }
    expect(P.filesView({ ...listing, path: vol.path }, { ...ctx, name: 'p7y-shop', volume: solo })).toContain('>portainer is running')
  })
  it("volumesView: the sandbox's volumes to open, who uses them; none says so", () => {
    const html = P.volumesView({ volumes: [vol, { name: '3f9a <x>', path: '/var/lib/docker/volumes/3f9a/_data', project: null, containers: [] }] }, { ...ctx, name: 'p7y-shop' })
    expect(html).toContain(`data-files-path="${vol.path}"`)
    expect(html).toContain('/var/lib/postgresql/data')
    expect(html).toContain('3f9a &lt;x&gt;')
    expect(html).toMatch(/files-root on[^>]*data-files-volumes/)
    expect(P.volumesView({ volumes: [] }, { ...ctx, name: 'p7y-shop' })).toContain('No volumes')
  })
})

describe('Apps: the Hub', () => {
  it('marks the apps on the Hub, with a link to it, and names published ones that have no web address', () => {
    const s = { ...running, hub: { enabled: true, url: 'https://hub.lvh.me', published: ['shop-portainer.lvh.me'], unlinked: ['worker'] } }
    const apps = panelOf(P.renderPanel(s, ctx), 'apps')
    expect(apps).toContain('<a class="tag" href="https://hub.lvh.me" target="_blank" rel="noopener">On the Hub</a>')
    expect(apps.match(/On the Hub/g)).toHaveLength(1)
    expect(apps).toContain('worker: published, but has no web address (publish a port on all interfaces)')
  })
  it('shows nothing about the Hub without it', () => {
    expect(panelOf(P.renderPanel(running, ctx), 'apps')).not.toContain('On the Hub')
  })
})

describe('Apps: an unusable p7y.image', () => {
  it('says why the image is ignored', () => {
    const s = { ...running, hub: { enabled: true, url: 'https://hub.lvh.me', published: [], unlinked: [], bad_image: ['web'] } }
    expect(panelOf(P.renderPanel(s, ctx), 'apps')).toContain('web: p7y.image is ignored: use a path inside the app, e.g. /shot.png')
  })
})

describe('header: when it last ran', () => {
  const asleep = { ...running, status: 'exited', stops_at: null, deep_sleep_at: '2026-10-11T15:00:00Z', last_running_at: '2026-09-13T15:00:00Z', last_running_estimated: false }
  it('asleep: "Last ran 3 weeks ago", the exact time on hover', () => {
    const html = P.renderPanel(asleep, ctx)
    expect(html).toMatch(/<span title="[^"]*2026[^"]*">Last ran 3 weeks ago<\/span>/)
  })
  it('deep sleep with an estimate: "~"', () => {
    const html = P.renderPanel({ ...asleep, status: 'deep_sleep', deep_sleep_at: null, last_running_at: '2026-08-04T15:00:00Z', last_running_estimated: true }, ctx)
    expect(html).toContain('>Last ran ~2 months ago</span>')
    expect(html).toContain('In deep sleep')
  })
  it('nothing while it runs, or when unknown', () => {
    expect(P.renderPanel(running, ctx)).not.toContain('Last ran')
    expect(P.renderPanel({ ...asleep, last_running_at: null }, ctx)).not.toContain('Last ran')
  })
})

describe('header: going to sleep', () => {
  it('running with its session just expired: "Going to sleep…", not "not started yet"', () => {
    const html = P.renderPanel({ ...running, stops_at: null, going_to_sleep: true }, ctx)
    expect(html).toContain('Going to sleep…')
    expect(html).not.toContain('The idle countdown has not started yet')
  })
})
