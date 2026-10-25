import { describe, it, expect } from 'vitest'
import fs from 'fs'

// The MCP Registry entry: its name belongs to the p9m-team user, and the registry takes one server per remote address
// (https://p7y.{domain}/mcp and https://{purgatory_host}/mcp are the old entries').
const json = JSON.parse(fs.readFileSync('server.json', 'utf8'))

describe('server.json', () => {
  it('is io.github.p9m-team/p9m with a remote address of its own', () => {
    expect(json.name).toBe('io.github.p9m-team/p9m')
    expect(json.remotes[0].url).toBe('https://{purgatorium_host}/mcp')
    expect(Object.keys(json.remotes[0].variables)).toEqual(['purgatorium_host'])
  })
  it('carries no old name', () => {
    expect(JSON.stringify(json)).not.toMatch(/p7y|purgatory/i)
  })
})
