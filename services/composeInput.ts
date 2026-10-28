import yaml from 'js-yaml'

export const COMPOSE_MAX_BYTES = 256 * 1024

/**
 * Why a compose text given on create cannot be used, or null when it can. Checked before anything is written; docker
 * compose itself checks it in the sandbox (composeConfigInner), where its files, builds and the like are the sandbox's.
 */
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
  return null
}
