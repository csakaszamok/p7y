import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.join(__dirname, '..')
const json = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)])

/** The MCP tool names the API has (each route's openapi.mcp.name) */
const toolNames = new Set([
  ...files(path.join(root, 'routes')).filter(f => f.endsWith('.ts'))
    .flatMap(f => [...fs.readFileSync(f, 'utf8').matchAll(/mcp: \{ name: '([a-z_]+)'/g)].map(m => m[1])),
  // The plugin's local helper
  ...[...fs.readFileSync(path.join(root, 'plugins/p7y/mcp/p7y-local.mjs'), 'utf8').matchAll(/name: '([a-z_]+)'/g)].map(m => m[1]),
])

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

  it('asks for the Purgatory URL and a token (kept secret) and connects to its MCP with them', () => {
    expect(manifest.userConfig.p7y_url).toMatchObject({ type: 'string', required: true })
    expect(manifest.userConfig.p7y_token).toMatchObject({ type: 'string', required: true, sensitive: true })
    for (const v of Object.values(manifest.userConfig) as Record<string, unknown>[]) {
      expect(v.title).toBeTruthy()
      expect(v.description).toBeTruthy()
    }
    expect(manifest.mcpServers.p7y).toEqual({
      type: 'http',
      url: '${user_config.p7y_url}/mcp',
      headers: { Authorization: 'Bearer ${user_config.p7y_token}' },
    })
  })

  // The keys are written to disk on the user's machine, never through the model
  it('runs the local helper (setup_project_dir) with the same address and token', () => {
    expect(manifest.mcpServers['p7y-local']).toEqual({
      command: 'node',
      args: ['${CLAUDE_PLUGIN_ROOT}/mcp/p7y-local.mjs'],
      env: { P7Y_URL: '${user_config.p7y_url}', P7Y_TOKEN: '${user_config.p7y_token}' },
    })
    expect(fs.existsSync(path.join(pluginDir, 'mcp', 'p7y-local.mjs'))).toBe(true)
  })

  it('every skill has a name matching its folder and a description within the limit', () => {
    const skills = fs.readdirSync(path.join(pluginDir, 'skills'))
    expect(skills).toContain('deploy')
    for (const s of skills) {
      const fm = frontmatter(fs.readFileSync(path.join(pluginDir, 'skills', s, 'SKILL.md'), 'utf8'))
      expect(fm.name).toBe(s)
      expect(fm.description?.length ?? 0).toBeGreaterThan(20)
      expect(fm.description.length).toBeLessThanOrEqual(1024)
    }
  })

  it('the skills name only MCP tools the API has', () => {
    expect(toolNames.size).toBeGreaterThan(20)
    for (const f of files(path.join(pluginDir, 'skills')).filter(f => f.endsWith('.md'))) {
      const named = [...fs.readFileSync(f, 'utf8').matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map(m => m[1])
        .filter(n => /^(get|list|create|wake|sleep|set|keep|who|read|write|delete|restart|rotate|archive|deep|generate|add|revoke|sandbox|setup)_/.test(n))
      expect(named.length).toBeGreaterThan(0)
      for (const n of named) expect(toolNames, `${path.basename(path.dirname(f))}: ${n}`).toContain(n)
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
