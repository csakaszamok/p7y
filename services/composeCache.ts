import yaml from 'js-yaml'

/**
 * A compose file's text parsed, shared by the readers (limits, sleep settings, disk limit, deep sleep labels): a
 * list asks each of them for every sandbox, so the same unchanged file was parsed four times per row on every poll.
 * Keyed by the text itself, so an edit is never missed. Only for reading: the result must not be changed.
 */
const parsed = new Map<string, unknown>()
const MAX = 2000

export function parseComposeText(text: string): unknown {
  if (parsed.has(text)) return parsed.get(text)
  const doc = yaml.load(text)
  // Old texts (edited files, removed sandboxes) are not tracked one by one: past the limit everything goes
  if (parsed.size >= MAX) parsed.clear()
  parsed.set(text, doc)
  return doc
}
