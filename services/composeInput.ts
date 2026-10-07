import yaml from 'js-yaml'

export const COMPOSE_MAX_BYTES = 256 * 1024

/** Why a compose text given on create cannot be used, or null when it can. Checked before anything is written. */
export function checkCompose(text: unknown): string | null {
  if (typeof text !== 'string') return 'compose must be a string'
  if (Buffer.byteLength(text, 'utf8') > COMPOSE_MAX_BYTES) return 'compose must be at most 256 KB'
  let doc: unknown
  try { doc = yaml.load(text) } catch (err) {
    const e = err as { reason?: string; mark?: { line: number }; message?: string }
    return `compose is not valid YAML: ${e.reason ?? e.message ?? 'parse error'} (line ${(e.mark?.line ?? 0) + 1})`
  }
  const services = doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc as { services?: unknown }).services : undefined
  if (!services || typeof services !== 'object' || Array.isArray(services) || !Object.keys(services).length) {
    return 'compose needs at least one service under services:'
  }
  const local = localReadKey(doc as Record<string, unknown>)
  if (local) return `compose may not use ${local}: it would read files or settings of the Purgatory server (build images and the like through DOCKER_HOST or Portainer)`
  return null
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * The compose CLI runs inside the Purgatory container: these keys make it read files there (other
 * sandboxes' TLS keys, the token store) or its environment, and hand what it read to the sandbox.
 * Bind mounts are fine: those are resolved by the sandbox's own Docker.
 */
function localReadKey(doc: Record<string, unknown>): string | null {
  if ('include' in doc) return 'include'
  for (const [name, svc] of Object.entries(isObj(doc.services) ? doc.services : {})) {
    if (!isObj(svc)) continue
    for (const key of ['build', 'env_file', 'label_file']) if (key in svc) return `services.${name}.${key}`
    if (isObj(svc.extends) && 'file' in svc.extends) return `services.${name}.extends.file`
  }
  for (const top of ['secrets', 'configs']) {
    for (const [name, def] of Object.entries(isObj(doc[top]) ? doc[top] as Record<string, unknown> : {})) {
      if (!isObj(def)) continue
      for (const key of ['file', 'environment']) if (key in def) return `${top}.${name}.${key}`
    }
  }
  return null
}
