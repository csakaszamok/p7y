import fs from 'fs'
import yaml from 'js-yaml'
import { composeUpService } from './compose'
import { nudgeTraefik } from './project'
import { parseDuration } from './duration'
import { sandboxParent } from './sandboxPaths'

export interface SleepSettings {
  idle_timeout: string
  deep_sleep_after: string
}

type Services = Record<string, { labels?: Record<string, string> } | undefined>

const IDLE_TIMEOUT = /^[1-9][0-9]*(s|m|h)$/
/** Sablier has no "never": an idle_timeout of off is a 10-year session (a stopped sandbox still wakes). */
const NEVER_SESSION = '87600h'
const isOff = (v: unknown) => v === 'off' || v === '0' || v === 0

/** A requested idle_timeout → "off" (0 or off), the duration itself, or null if invalid. */
export function normalizeIdleTimeout(v: unknown): string | null {
  if (isOff(v)) return 'off'
  return typeof v === 'string' && IDLE_TIMEOUT.test(v) ? v : null
}

/** A requested deep_sleep_after → "off" (0 or off), the duration itself, or null if invalid. */
export function normalizeDeepSleepAfter(v: unknown): string | null {
  if (isOff(v)) return 'off'
  return typeof v === 'string' && parseDuration(v, 'mhd') !== null ? v : null
}

/** The Sablier sessionDuration label value for an idle_timeout. */
export const sessionDurationOf = (idle: string) => idle === 'off' ? NEVER_SESSION : idle
// Legacy (Leander-era) sandboxes carry leander.deep_sleep_after instead.
const DEEP_SLEEP_LABELS = ['p7y.deep_sleep_after', 'leander.deep_sleep_after']
const deepSleepKey = (labels?: Record<string, string>) => DEEP_SLEEP_LABELS.find(k => labels?.[k] !== undefined)
const idleLabel = (name: string) => `traefik.http.middlewares.sablier-${name}.plugin.sablier.sessionDuration`

export function composePathOf(name: string): string {
  return `${sandboxParent(name)}/${name}/docker-compose.yml`
}

function services(text: string): Services {
  const doc = yaml.load(text) as { services?: Services } | null
  return doc?.services ?? {}
}

/** The sleep settings as written in a sandbox's compose file (socat carries the Sablier middleware, sandbox the deep sleep label). */
export function readSleepSettings(text: string, name: string): Partial<SleepSettings> {
  const s = services(text)
  const session = s.socat?.labels?.[idleLabel(name)]
  return {
    idle_timeout: session === NEVER_SESSION ? 'off' : session,
    deep_sleep_after: s.sandbox?.labels?.[deepSleepKey(s.sandbox?.labels) ?? DEEP_SLEEP_LABELS[0]]
  }
}

/** The compose file with the given sleep settings applied. */
export function withSleepSettings(text: string, name: string, changes: Partial<SleepSettings>): string {
  const doc = (yaml.load(text) ?? {}) as { services?: Services }
  const socat = doc.services?.socat?.labels
  const sandbox = doc.services?.sandbox?.labels
  const deepKey = deepSleepKey(sandbox)
  if (!socat?.[idleLabel(name)] || !sandbox || !deepKey) {
    throw new Error(`Sleep settings of ${name} cannot be changed: its compose file has no sleep labels`)
  }
  if (changes.idle_timeout !== undefined) socat[idleLabel(name)] = sessionDurationOf(changes.idle_timeout)
  if (changes.deep_sleep_after !== undefined) sandbox[deepKey] = changes.deep_sleep_after
  return yaml.dump(doc, { lineWidth: -1 })
}

/** A request body → the changes to apply, or an error message. */
export function validateSleepSettings(body: unknown): Partial<SleepSettings> | string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'Body must be a JSON object'
  const { idle_timeout, deep_sleep_after } = body as Record<string, unknown>
  const out: Partial<SleepSettings> = {}
  if (idle_timeout !== undefined) {
    const v = normalizeIdleTimeout(idle_timeout)
    if (v === null) return 'idle_timeout must look like 30s, 15m or 2h, or 0 / off for never'
    out.idle_timeout = v
  }
  if (deep_sleep_after !== undefined) {
    const v = normalizeDeepSleepAfter(deep_sleep_after)
    if (v === null) return 'deep_sleep_after must look like 30m, 12h or 7d, or 0 / off for never'
    out.deep_sleep_after = v
  }
  if (Object.keys(out).length === 0) return 'nothing to change: give idle_timeout and/or deep_sleep_after'
  return out
}

/**
 * Writes the new settings into the compose file. A changed sleep time needs the
 * socat container recreated (Traefik reads the middleware from its labels);
 * the DinD container and the inner stack are left alone. The deep sleep time
 * is read from the compose file, so no container changes for it.
 */
/**
 * A running Sablier session keeps the expiry it was opened with (10 years while sleep was off) until a request
 * renews it: send one (as Reset does), and again while Traefik still serves the old middleware settings.
 */
async function renewSession(name: string, idleTimeout: string | undefined): Promise<void> {
  const { primeSablierSession } = await import('./wake')
  const { sleepTimes } = await import('./sleepTimes')
  const ms = idleTimeout && idleTimeout !== 'off' ? parseDuration(idleTimeout) : null
  if (ms === null) { await primeSablierSession(name, 3); return } // off: nothing to compare with
  const want = ms / 1000
  for (let i = 0; i < 10; i++) {
    await primeSablierSession(name, 3)
    const { stops_in } = await sleepTimes(name)
    // Just renewed with the new time: within a minute of it (shorter or longer than the old one alike)
    if (stops_in === null || Math.abs(stops_in - want) <= 60) return
    await new Promise(r => setTimeout(r, 1000))
  }
}

export async function updateSleepSettings(
  name: string, status: string, changes: Partial<SleepSettings>, composePath = composePathOf(name),
  deps: { renew?: (name: string, idleTimeout: string | undefined) => Promise<void> } = {},
): Promise<SleepSettings> {
  const before = fs.readFileSync(composePath, 'utf8')
  const after = withSleepSettings(before, name, changes)
  fs.writeFileSync(composePath, after)
  const idleChanged = readSleepSettings(before, name).idle_timeout !== readSleepSettings(after, name).idle_timeout
  if (idleChanged && status !== 'deep_sleep') {
    await composeUpService(composePath, 'socat', status === 'running')
    await nudgeTraefik()
    // The countdown should show the new time now, not after the next visit
    if (status === 'running') await (deps.renew ?? renewSession)(name, readSleepSettings(after, name).idle_timeout).catch(() => {})
  }
  return readSleepSettings(after, name) as SleepSettings
}

/** The sandbox's sleep settings from its compose file; {} if it cannot be read. */
export function sleepSettingsOf(name: string, composePath = composePathOf(name)): Partial<SleepSettings> {
  try {
    const settings = readSleepSettings(fs.readFileSync(composePath, 'utf8'), name)
    return Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined))
  } catch {
    return {}
  }
}

/** deep_sleep_after from the sandbox's compose file, or undefined if it cannot be read. */
export function composeDeepSleepAfter(name: string, composePath = composePathOf(name)): string | undefined {
  return sleepSettingsOf(name, composePath).deep_sleep_after
}
