import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('shipped templates', () => {
  // 127.0.0.1:port:port is private to the sandbox (no link): the demo stacks publish on all interfaces
  it('publish no port on 127.0.0.1', () => {
    for (const dir of fs.readdirSync(path.join(process.cwd(), 'templates'))) {
      const file = path.join(process.cwd(), 'templates', dir, 'compose.yaml')
      if (!fs.existsSync(file)) continue
      const ports = fs.readFileSync(file, 'utf8').split('\n').filter(l => /^\s*-\s*"?127\.0\.0\.1:/.test(l))
      expect(ports, dir).toEqual([])
    }
  })
})
