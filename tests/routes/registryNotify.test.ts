import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-notify-'))
vi.stubEnv('REGISTRY_NOTIFY_SECRET_FILE', path.join(dir, 'registry-notify.secret'))
vi.mock('../../services/registryScans', () => ({ markPushed: vi.fn(() => true), enqueueScan: vi.fn(async () => {}) }))
const S = await import('../../services/registryScans')
const { notifySecret } = await import('../../services/notifySecret')
const { default: post } = await import('../../routes/registry/notify/POST')
const body = { events: [
  { action: 'push', target: { repository: 'shop/todo', digest: 'sha256:idx', tag: '3' } },
  { action: 'push', target: { repository: 'shop/todo', digest: 'sha256:bydigest' } }, // untagged: still pullable by digest
  { action: 'pull', target: { repository: 'shop/todo', digest: 'sha256:idx' } },
] }
const req = (secret?: string) => new Request('http://p7y:3000/registry/notify', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify(body) })

describe('POST /registry/notify', () => {
  it('a generated secret (no default): every push is recorded and queued, tagged or not; pulls ignored', async () => {
    const secret = notifySecret()
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    expect(fs.readFileSync(process.env.REGISTRY_NOTIFY_SECRET_FILE!, 'utf8').trim()).toBe(secret)
    expect((await post(req(secret))).status).toBe(200)
    expect(S.markPushed).toHaveBeenCalledWith('shop/todo', 'sha256:idx', '3')
    expect(S.markPushed).toHaveBeenCalledWith('shop/todo', 'sha256:bydigest', undefined)
    expect(S.enqueueScan).toHaveBeenCalledTimes(2)
  })
  it('401 without the secret, with a wrong one, or with the old default', async () => {
    expect((await post(req())).status).toBe(401)
    expect((await post(req('nope'))).status).toBe(401)
    expect((await post(req('change-me-notify'))).status).toBe(401)
  })
})
