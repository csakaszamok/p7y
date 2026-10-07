import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
vi.mock('../../services/tokens', () => ({ resolveToken: vi.fn(() => null) }))
vi.mock('../../services/runtimeLoader', () => ({
  listRuntimes: () => [{ name: 'dind', description: 'Docker-in-Docker', docker_compose: {} }, { name: 'sysbox', description: 'Sysbox', docker_compose: {}, daemon_json: { tls: true } }]
}))
vi.mock('../../services/templateLoader', () => ({
  listTemplates: () => [{ name: 'starter', description: 'Portainer', compose: {}, before_script: 'secret' }, { name: 'tcp-demo', description: 'TCP demo', compose: {} }],
  loadTemplate: (name: string) => {
    if (name !== 'starter') throw new Error(`Template not found: ${name}`)
    return { name: 'starter', description: 'Portainer', compose: {} }
  },
  loadTemplateText: (name: string) => {
    if (name !== 'starter') throw new Error(`Template not found: ${name}`)
    return '# starter\nservices: {}\n'
  },
}))

const { default: runtimes } = await import('../../routes/runtimes/GET')
const { default: templates } = await import('../../routes/templates/GET')
const { default: templateOne } = await import('../../routes/templates/[name]/GET')
const req = (path: string, auth: string | null = 'Bearer admin-secret') =>
  new Request(`http://localhost${path}`, { headers: auth ? { Authorization: auth } : {} })

describe('GET /runtimes and GET /templates', () => {
  it('list name, description and which one is the default (nothing else)', async () => {
    expect(await (await runtimes(req('/runtimes'))).json()).toEqual([
      { name: 'dind', description: 'Docker-in-Docker', default: true },
      { name: 'sysbox', description: 'Sysbox', default: false },
    ])
    expect(await (await templates(req('/templates'))).json()).toEqual([
      { name: 'starter', description: 'Portainer', default: true },
      { name: 'tcp-demo', description: 'TCP demo', default: false },
    ])
  })

  it('follow DEFAULT_RUNTIME / DEFAULT_TEMPLATE', async () => {
    vi.stubEnv('DEFAULT_RUNTIME', 'sysbox')
    vi.stubEnv('DEFAULT_TEMPLATE', 'tcp-demo')
    try {
      expect((await (await runtimes(req('/runtimes'))).json()).find((r: { default: boolean }) => r.default).name).toBe('sysbox')
      expect((await (await templates(req('/templates'))).json()).find((t: { default: boolean }) => t.default).name).toBe('tcp-demo')
    } finally { delete process.env.DEFAULT_RUNTIME; delete process.env.DEFAULT_TEMPLATE }
  })

  it('require authentication', async () => {
    expect((await runtimes(req('/runtimes', null))).status).toBe(401)
    expect((await templates(req('/templates', null))).status).toBe(401)
  })
})

describe('GET /templates/:name', () => {
  it('gives the compose text as written', async () => {
    expect(await (await templateOne(req('/templates/starter'))).json())
      .toEqual({ name: 'starter', description: 'Portainer', default: true, compose: '# starter\nservices: {}\n' })
  })
  it('404s an unknown template and 401s without a login', async () => {
    const res = await templateOne(req('/templates/nope'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Template not found' })
    expect((await templateOne(req('/templates/starter', null))).status).toBe(401)
  })
})
