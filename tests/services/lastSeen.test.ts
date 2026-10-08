import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { rememberLastSeen, lastSeen } from '../../services/lastSeen'
import { rememberedTcpPorts } from '../../services/tcpNames'

describe('lastSeen', () => {
  it('keeps a value in <what>.json in the sandbox directory and reads it back; null before', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-lastseen-'))
    expect(lastSeen(dir, 'tcp')).toBeNull()
    rememberLastSeen(dir, 'tcp', [{ host: 'a-db-tcp.lvh.me', port: 5432, privatePort: 5432 }])
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'tcp.json'), 'utf8'))).toEqual([{ host: 'a-db-tcp.lvh.me', port: 5432, privatePort: 5432 }])
    expect(lastSeen(dir, 'tcp')).toEqual([{ host: 'a-db-tcp.lvh.me', port: 5432, privatePort: 5432 }])
  })

  it('a gone directory is no error', () => {
    expect(() => rememberLastSeen(path.join(os.tmpdir(), 'p7y-no-such-dir', 'x'), 'apps', [])).not.toThrow()
  })

  it('rememberedTcpPorts: only well-formed entries', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-lastseen-'))
    fs.mkdirSync(path.join(parent, 'p7y-db'))
    expect(rememberedTcpPorts('p7y-db', parent)).toBeNull()
    rememberLastSeen(path.join(parent, 'p7y-db'), 'tcp', [{ host: 'db-tcp.lvh.me', port: 5432, privatePort: 5432 }, { nope: 1 }])
    expect(rememberedTcpPorts('p7y-db', parent)).toEqual([{ host: 'db-tcp.lvh.me', port: 5432, privatePort: 5432 }])
  })
})
