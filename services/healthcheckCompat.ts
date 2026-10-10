import { engineApiVersion } from './docker'

/**
 * A healthcheck's start_interval (checks more often while a container starts) needs Docker Engine 25 (API 1.44):
 * below that docker compose refuses the file. The runtimes use it so a new sandbox's router shows up sooner;
 * on an older engine it is taken out, and the sandbox starts as before.
 */
export function withoutStartInterval(compose: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(compose) as { services?: Record<string, { healthcheck?: Record<string, unknown> } | undefined> }
  for (const service of Object.values(copy.services ?? {})) {
    if (service?.healthcheck) delete service.healthcheck.start_interval
  }
  return copy as Record<string, unknown>
}

const atLeast = (version: string, [major, minor]: [number, number]) => {
  const [a, b] = version.split('.').map(Number)
  return a > major || (a === major && b >= minor)
}

/** Whether the engine takes start_interval; asked once. Unknown (no daemon answer): no, which works everywhere. */
// The engine is asked on first use, not when this module loads
export function createStartIntervalCheck(apiVersion: () => Promise<string> = () => engineApiVersion()) {
  let answer: Promise<boolean> | undefined
  return () => (answer ??= Promise.resolve().then(apiVersion).then(v => atLeast(v, [1, 44]), () => false))
}

export const startIntervalSupported = createStartIntervalCheck()
