import { requirePrincipal } from '../../../services/principal'
import { getOwnedSandbox } from '../../../services/access'
import { validateSleepSettings, updateSleepSettings, sleepSettingsOf } from '../../../services/sleepSettings'
import { checkLimits, resourceDefaults } from '../../../services/resources'
import { applyLimits, limitsOf } from '../../../services/resourceSettings'
import { hostResources } from '../../../services/docker'
import { setDiskLimit, diskOf } from '../../../services/diskUsage'
import { parseMemory } from '../../../services/resources'

export const openapi = {
  mcp: { name: 'set_sleep_settings' },
  summary: 'Change sleep settings',
  description: 'Changes idle_timeout and/or deep_sleep_after of an existing sandbox. A new idle_timeout recreates only the socat container (a running sandbox\'s app is unreachable for a few seconds; an asleep one stays asleep) and applies to the next request\'s Sablier session. A new deep_sleep_after applies immediately.',
  tags: ['sandboxes'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            idle_timeout: { type: 'string', pattern: '^([1-9][0-9]*(s|m|h)|0|off)$', example: '45m' },
            deep_sleep_after: { type: 'string', pattern: '^([1-9][0-9]*(m|h|d)|0|off)$', example: '14d' },
            disk: { type: 'string', example: '50g', description: 'Admin only: the disk use above which the sandbox is flagged (a warning, nothing is stopped). Default SANDBOX_DISK.' }
          }
        }
      }
    }
  },
  responses: {
    200: { description: 'The sandbox\'s sleep settings after the change' },
    400: { description: 'Invalid value' },
    401: { description: 'Unauthorized' },
    404: { description: 'Sandbox not found' }
  }
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p
  const name = new URL(req.url).pathname.split('/')[2]

  let body: unknown
  try { body = await req.json() } catch { return Response.json({ error: 'Body must be a JSON object' }, { status: 400 }) }
  const b = (typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {}) as Record<string, unknown>
  const wantsSleep = b.idle_timeout !== undefined || b.deep_sleep_after !== undefined
  const wantsLimits = b.cpus !== undefined || b.memory !== undefined
  const wantsDisk = b.disk !== undefined
  if (!wantsSleep && !wantsLimits && !wantsDisk) return Response.json({ error: 'nothing to change: give idle_timeout, deep_sleep_after, cpus, memory and/or disk' }, { status: 400 })
  // Only a warning threshold: a user raising their own would make it mean nothing
  if (wantsDisk && p.role !== 'admin') return Response.json({ error: 'only the administrator can change the disk limit' }, { status: 403 })
  const disk = wantsDisk ? parseMemory(b.disk) : null
  if (wantsDisk && (disk === null || disk < 1024 ** 3)) return Response.json({ error: 'disk must look like 20g, at least 1g' }, { status: 400 })
  const changes = wantsSleep ? validateSleepSettings({ idle_timeout: b.idle_timeout, deep_sleep_after: b.deep_sleep_after }) : null
  if (typeof changes === 'string') return Response.json({ error: changes }, { status: 400 })
  const def = resourceDefaults()
  const lim = wantsLimits ? checkLimits({ cpus: b.cpus, memory: b.memory }, p.role, { ceiling: def.ceiling, host: await hostResources() }) : null
  if (lim && !lim.ok) return Response.json({ error: lim.error }, { status: lim.status })

  try {
    const sandbox = await getOwnedSandbox(p, name)
    // Limits first: a refused change (409) must leave the sleep settings of the same request alone
    const limits = lim?.ok
      ? await applyLimits(name, sandbox.status, { ...(lim.cpus !== undefined ? { cpus: lim.cpus } : {}), ...(lim.memory !== undefined ? { memory: lim.memory } : {}) })
      : limitsOf(name)
    if (disk !== null) await setDiskLimit(name, disk)
    const settings = changes ? await updateSleepSettings(name, sandbox.status, changes) : sleepSettingsOf(name)
    return Response.json({ name, ...settings, limits, ...(disk !== null ? { disk: diskOf(name) } : {}) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'error'
    if (msg.includes('not found')) return Response.json({ error: msg }, { status: 404 })
    if (msg.includes('Invalid sandbox name')) return Response.json({ error: msg }, { status: 400 })
    if (msg.includes('cannot be changed') || msg.startsWith('now using') || msg.startsWith('cannot check its memory use')) return Response.json({ error: msg }, { status: 409 })
    return Response.json({ error: msg }, { status: 500 })
  }
}
