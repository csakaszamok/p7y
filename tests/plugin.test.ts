import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.join(__dirname, '..')
const json = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)])

/** The route file a `METHOD /path` names (`:name` → `[name]`), as the file router maps them */
const routeFile = (method: string, p: string) =>
  path.join(root, 'routes', ...p.split('/').filter(Boolean).map(s => s.startsWith(':') ? `[${s.slice(1)}]` : s), `${method}.ts`)

function frontmatter(md: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md)
  if (!m) return {}
  return Object.fromEntries(m[1].split(/\r?\n/).map(l => /^([a-z-]+):\s*(.*)$/.exec(l)).filter(Boolean).map(x => [x![1], x![2]]))
}

describe('the Claude Code plugin', () => {
  const market = json('.claude-plugin/marketplace.json')
  const entry = market.plugins.find((p: { name: string }) => p.name === 'p7y')
  const pluginDir = path.join(root, entry?.source ?? '')
  const manifest = json(path.join(entry?.source ?? '', '.claude-plugin/plugin.json'))

  it('the marketplace lists the p7y plugin from this repository', () => {
    expect(market.name).toBe('p7y')
    expect(market.owner?.name).toBeTruthy()
    expect(entry?.source).toBe('./plugins/p7y')
    expect(manifest.name).toBe('p7y')
  })

  it('has the version of the release it comes with (an installed plugin updates when it changes)', () => {
    expect(manifest.version).toBe(json('package.json').version)
  })

  // Each project's .p7y/p7y.env says which Purgatory, sandbox and token: the plugin keeps none
  it('has no MCP server and asks nothing', () => {
    expect(manifest.mcpServers).toBeUndefined()
    expect(manifest.userConfig).toBeUndefined()
    expect(fs.existsSync(path.join(pluginDir, 'mcp'))).toBe(false)
  })

  it('skills: init and deploy', () => {
    expect(fs.readdirSync(path.join(pluginDir, 'skills')).sort()).toEqual(['deploy', 'init'])
  })

  it('every skill has a name matching its folder and a description within the limit', () => {
    const skills = fs.readdirSync(path.join(pluginDir, 'skills'))
    for (const s of skills) {
      const fm = frontmatter(fs.readFileSync(path.join(pluginDir, 'skills', s, 'SKILL.md'), 'utf8'))
      expect(fm.name).toBe(s)
      expect(fm.description?.length ?? 0).toBeGreaterThan(20)
      expect(fm.description.length).toBeLessThanOrEqual(1024)
    }
  })

  it('the skills call only routes the API has', () => {
    for (const f of files(path.join(pluginDir, 'skills')).filter(f => f.endsWith('.md'))) {
      const calls = [...fs.readFileSync(f, 'utf8').matchAll(/`(GET|POST|PATCH|DELETE) (\/[^`\s]+)`/g)]
      expect(calls.length, f).toBeGreaterThan(0)
      for (const [, method, p] of calls) expect(fs.existsSync(routeFile(method, p)), `${path.basename(path.dirname(f))}: ${method} ${p}`).toBe(true)
    }
  })

  it('init starts and polls a device approval', () => {
    const md = fs.readFileSync(path.join(pluginDir, 'skills/init/SKILL.md'), 'utf8')
    expect(md).toContain('`POST /device/code`')
    expect(md).toContain('`POST /device/poll`')
    expect(frontmatter(md)['argument-hint']).toBe('<purgatory address> <sandbox>')
  })

  it('no skill uses the plugin\'s old settings or MCP tools', () => {
    for (const f of files(path.join(pluginDir, 'skills'))) {
      const text = fs.readFileSync(f, 'utf8')
      expect(text, f).not.toMatch(/userConfig|user_config|who_am_i/)
    }
  })

  it('no secrets or internal hosts in the plugin', () => {
    for (const f of files(pluginDir)) {
      const text = fs.readFileSync(f, 'utf8')
      expect(text, f).not.toMatch(/p7y_[A-Za-z0-9]{20,}/)
      // No address other than the two the deploy rules name
      const ips = [...text.matchAll(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g)].map(m => m[0])
      expect(ips.filter(ip => ip !== '127.0.0.1' && ip !== '0.0.0.0'), f).toEqual([])
    }
  })
})
