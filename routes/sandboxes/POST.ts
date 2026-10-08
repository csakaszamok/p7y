import { defaultRuntime, runtimeMissing, runtimeAllowed } from '../../services/defaultRuntime'
import { sandboxService } from '../../services/sandbox'
import { reserveSandboxSlot } from '../../services/quota'
import { normalizeIdleTimeout, normalizeDeepSleepAfter } from '../../services/sleepSettings'
import { requirePrincipal } from '../../services/principal'
import { listTemplates, loadTemplate } from '../../services/templateLoader'
import { listRuntimes } from '../../services/runtimeLoader'
import { checkCompose } from '../../services/composeInput'
import { parsePublicKey } from '../../services/sshKeys'
import { checkLimits, resourceDefaults, clampToHost } from '../../services/resources'
import { hostResources } from '../../services/docker'

export const openapi = {
  mcp: { name: 'create_sandbox' },
  summary: 'Create sandbox',
  tags: ['sandboxes'],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,62}$', example: 'user1' },
            runtime: { type: 'string', example: 'dind', description: 'How the sandbox runs (GET /runtimes). Omit for DEFAULT_RUNTIME (auto: sysbox where installed, else dind).' },
            template: { type: 'string', example: 'starter', description: 'What runs inside (GET /templates). Omit for DEFAULT_TEMPLATE (starter).' },
            cpus: { type: 'number', example: 2, description: 'CPU limit (cores). Default SANDBOX_CPUS; users up to SANDBOX_MAX_CPUS, the admin up to the host.' },
            memory: { type: 'string', example: '4g', description: 'Memory limit (512m, 4g). Default SANDBOX_MEMORY; users up to SANDBOX_MAX_MEMORY, the admin up to the host.' },
            ssh_keys: { type: 'array', maxItems: 10, items: { type: 'string' }, description: 'Extra SSH public keys for this sandbox only (your keys from /ssh-keys always get in)' },
            compose: { type: 'string', description: "Use this compose text instead of the template's compose.yaml (the template's before_script and defaults still apply). GET /templates/:name gives the template's text to start from. At most 256 KB." },
            create_inner_stack: { type: 'boolean', default: true, description: 'Whether to deploy the inner docker-compose stack defined in the template' },
            idle_timeout: { type: 'string', pattern: '^([1-9][0-9]*(s|m|h)|0|off)$', example: '30m', description: 'Stop the sandbox after this long without HTTP traffic; the next request wakes it. 0 or off = never. Omit for template idle_timeout (default 30m).' },
            deep_sleep_after: { type: 'string', pattern: '^([1-9][0-9]*(m|h|d)|0|off)$', example: '7d', description: 'Take the sandbox down (containers + network freed, data kept) after it has been stopped this long; the next request rebuilds it. "off" disables. Omit for template deep_sleep_after (default 7d).' }
          }
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Sandbox created — certs returned only once',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              docker_host: { type: 'string', example: '' },
              ca_cert: { type: 'string' },
              client_cert: { type: 'string' },
              client_key: { type: 'string' },
              registry_url: { type: 'string', example: 'registry.my.local' },
              registry_username: { type: 'string' },
              registry_password: { type: 'string' },
              tunnel_urls: { type: 'array', items: { type: 'string' } },
              extras: { type: 'object', additionalProperties: { type: 'string' }, description: 'Template-specific outputs (e.g. portainer_password, portainer_url)' }
            }
          }
        }
      }
    },
    400: { description: 'Invalid or missing name' },
    401: { description: 'Unauthorized' },
    409: { description: 'Name taken/conflicting, or sandbox limit reached' },
    503: { description: 'No free ports available in template range' }
  },
  security: [{ bearerAuth: [] }],
}

export default async (req: Request): Promise<Response> => {
  const p = requirePrincipal(req)
  if (p instanceof Response) return p

  const body = await req.json().catch(() => ({}))
  const { name, runtime, template, compose, ssh_keys, cpus, memory, create_inner_stack, idle_timeout, deep_sleep_after } = body as { name?: string; runtime?: unknown; template?: unknown; compose?: unknown; ssh_keys?: unknown; cpus?: unknown; memory?: unknown; create_inner_stack?: boolean; idle_timeout?: unknown; deep_sleep_after?: unknown }

  if (!name || typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 })
  }

  const trimmed = name.trim()
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(trimmed)) {
    return Response.json({ error: 'name must be 1-63 lowercase alphanumeric/underscore/hyphen characters' }, { status: 400 })
  }

  if ('ttl' in body) {
    return Response.json({ error: 'ttl was removed: sandboxes only sleep when idle, use idle_timeout (e.g. "30m")' }, { status: 400 })
  }

  // Ends up verbatim in compose labels, so only allow a plain Go duration (or 0 / off = never).
  const idle = idle_timeout === undefined ? undefined : normalizeIdleTimeout(idle_timeout)
  if (idle === null) {
    return Response.json({ error: 'idle_timeout must look like 30s, 15m or 2h, or 0 / off for never' }, { status: 400 })
  }
  const deep = deep_sleep_after === undefined ? undefined : normalizeDeepSleepAfter(deep_sleep_after)
  if (deep === null) {
    return Response.json({ error: 'deep_sleep_after must look like 30m, 12h or 7d, or 0 / off for never' }, { status: 400 })
  }

  if (runtime !== undefined && typeof runtime !== 'string') {
    return Response.json({ error: 'runtime must be a string' }, { status: 400 })
  }
  if (template !== undefined && typeof template !== 'string') {
    return Response.json({ error: 'template must be a string' }, { status: 400 })
  }
  // The defaults are checked too: a stale DEFAULT_TEMPLATE (e.g. the removed dind-standard) is a 400, not a 500
  const runtimeName = runtime ?? await defaultRuntime()
  const templateName = template ?? (process.env.DEFAULT_TEMPLATE || 'starter')
  if (!listRuntimes().some(r => r.name === runtimeName)) {
    return Response.json({ error: 'Unknown runtime' }, { status: 400 })
  }
  if (!runtimeAllowed(runtimeName)) {
    const why = runtime === undefined ? `the default runtime (${runtimeName}) is not allowed on this server` : `${runtimeName} is not allowed on this server`
    return Response.json({ error: `${why} (ALLOWED_RUNTIMES): pick one of GET /runtimes` }, { status: 400 })
  }
  const missing = await runtimeMissing(runtimeName)
  if (missing) return Response.json({ error: missing }, { status: 400 })
  if (!listTemplates().some(t => t.name === templateName)) {
    return Response.json({ error: 'Unknown template' }, { status: 400 })
  }
  // e.g. the empty template: nothing to start unless the request brings a compose text
  const templateServices = (loadTemplate(templateName).compose as { services?: unknown }).services
  const hasServices = !!templateServices && typeof templateServices === 'object' && Object.keys(templateServices).length > 0
  if (compose === undefined && create_inner_stack !== false && !hasServices) {
    return Response.json({ error: `The ${templateName} template has no services: paste a compose file` }, { status: 400 })
  }
  if (compose !== undefined) {
    const problem = checkCompose(compose)
    if (problem) return Response.json({ error: problem }, { status: 400 })
    if (create_inner_stack === false) return Response.json({ error: 'compose needs create_inner_stack' }, { status: 400 })
  }
  let sshKeys: string[] | undefined
  if (ssh_keys !== undefined) {
    if (!Array.isArray(ssh_keys) || ssh_keys.some(k => typeof k !== 'string')) return Response.json({ error: 'ssh_keys must be a list of public keys' }, { status: 400 })
    if (ssh_keys.length > 10) return Response.json({ error: 'at most 10 ssh_keys' }, { status: 400 })
    sshKeys = []
    for (const [i, k] of (ssh_keys as string[]).entries()) {
      const parsed = parsePublicKey(k)
      if ('error' in parsed) return Response.json({ error: `ssh_keys[${i}]: ${parsed.error}` }, { status: 400 })
      sshKeys.push(parsed.comment ? `${parsed.line} ${parsed.comment}` : parsed.line)
    }
  }

  // Users up to SANDBOX_MAX_*, the admin up to the host; what is not given gets the default
  const def = resourceDefaults()
  const host = await hostResources()
  const lim = checkLimits({ cpus, memory }, p.role, { ceiling: def.ceiling, host })
  if (!lim.ok) return Response.json({ error: lim.error }, { status: lim.status })
  const base = clampToHost(def.limits, host)
  const limits = { cpus: lim.cpus ?? base.cpus, memory: lim.memory ?? base.memory }

  const slot = await reserveSandboxSlot(p)
  if (!slot.ok) {
    return Response.json({ error: slot.scope === 'server'
      ? `The server is full (${slot.limit} sandboxes): ask the administrator.`
      : `${slot.limit} running sandbox${slot.limit === 1 ? '' : 'es'} allowed: put one to sleep first (Sleep in its panel), then create a new one.` }, { status: 409 })
  }

  try {
    const result = await sandboxService.createSandbox(trimmed, create_inner_stack ?? true, idle, deep, p.sub, templateName, runtimeName, compose as string | undefined, sshKeys, limits)
    return Response.json(result, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[POST /sandboxes] error:', err instanceof Error ? err.stack : err)
    if (msg.includes('already exists') || msg.includes('conflicts with an existing sandbox')) return Response.json({ error: msg }, { status: 409 })
    if (msg.startsWith('compose is not a valid compose file')) return Response.json({ error: msg }, { status: 400 })
    if (msg.includes('No free ports')) return Response.json({ error: msg }, { status: 503 })
    if (msg.includes('fully subnetted')) return Response.json({ error: 'No free Docker networks available — run docker network prune' }, { status: 503 })
    return Response.json({ error: msg }, { status: 500 })
  } finally {
    slot.release()
  }
}
