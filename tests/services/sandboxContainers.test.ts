import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { containerRows, CONTAINER_NAME, CONTAINER_SHELL } from '../../services/sandboxContainers'

describe('containerRows', () => {
  it('running ones first, then by compose project and name; a container without a name by its short id', () => {
    const rows = containerRows([
      { Id: 'a'.repeat(64), Names: ['/shop-web-1'], Image: 'nginx', State: 'exited', Status: 'Exited (0) 1 hour ago', Labels: { 'com.docker.compose.project': 'shop', 'com.docker.compose.service': 'web' } },
      { Id: 'b'.repeat(64), Names: ['/claude-dev'], Image: 'claude-devcontainer:latest', State: 'running', Status: 'Up 2 hours', Labels: { 'com.docker.compose.project': 'claude', 'com.docker.compose.service': 'claude' } },
      { Id: 'c'.repeat(64), Names: [], Image: 'alpine', State: 'running', Status: 'Up 1 minute', Labels: null },
    ])
    expect(rows.map(r => r.name)).toEqual(['cccccccccccc', 'claude-dev', 'shop-web-1'])
    expect(rows[1]).toEqual({ name: 'claude-dev', project: 'claude', service: 'claude', image: 'claude-devcontainer:latest', state: 'running', status: 'Up 2 hours' })
    expect(rows[0]).toMatchObject({ project: null, service: null })
  })
})

describe('CONTAINER_NAME', () => {
  it('Docker names and ids only', () => {
    for (const ok of ['claude-dev', 'shop_web.1', 'a'.repeat(64)]) expect(CONTAINER_NAME.test(ok), ok).toBe(true)
    for (const bad of ['', '-x', '.x', 'a b', 'a;b', 'a/b', '$(id)']) expect(CONTAINER_NAME.test(bad), bad).toBe(false)
  })
})

describe('CONTAINER_SHELL', () => {
  const sh = (() => { try { execFileSync('sh', ['-c', 'true']); return true } catch { return false } })()
  it.skipIf(!sh)("picks a shell to run (the user's login shell, else bash, else sh), never nologin", () => {
    const script = CONTAINER_SHELL('/dev/null').replace(/exec "\$s" -l$/, 'echo "$s"')
    const out = execFileSync('sh', ['-c', script]).toString().trim()
    expect(out).toMatch(/\w$/)
    expect(out).not.toMatch(/nologin|false/)
  })
})
