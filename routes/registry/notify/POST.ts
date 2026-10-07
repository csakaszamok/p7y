import { markPushed, enqueueScan } from '../../../services/registryScans'
import { isNotifySecret } from '../../../services/notifySecret'

/** The registry's push notifications (registry/config.yml): every pushed version is scanned for secrets. */
export default async (req: Request): Promise<Response> => {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ') || !isNotifySecret(auth.slice(7))) return new Response('unauthorized', { status: 401 })
  const body = await req.json().catch(() => ({})) as { events?: Array<{ action?: string; target?: { repository?: string; digest?: string; tag?: string } }> }
  for (const e of body.events ?? []) {
    const t = e.target
    if (e.action !== 'push' || !t?.repository || !t.digest) continue
    // Untagged pushes too: a version pushed by digest can be pulled by digest
    if (markPushed(t.repository, t.digest, t.tag || undefined)) void enqueueScan(t.repository, t.digest)
  }
  return new Response('ok')
}
