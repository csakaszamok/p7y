/**
 * Local-dev defaults that must not survive into a publicly reachable
 * deployment. The dev stack (docker-compose.yml) and the e2e scripts rely on
 * these defaults, so they stay as defaults — but Purgatory logs a clear
 * warning at startup whenever one is still in effect.
 */
export function insecureConfigWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  const warnings: string[] = []
  if (env.ADMIN_TOKEN === 'abc123' || env.ADMIN_TOKEN === 'change-me-to-a-strong-secret') {
    warnings.push('WARNING: ADMIN_TOKEN is set to a default/example value. Set a strong ADMIN_TOKEN before exposing Purgatory publicly.')
  }
  if (env.SESSION_SECRET === 'change-me-to-a-long-random-string') {
    warnings.push('WARNING: SESSION_SECRET is set to the default placeholder. Set a long random SESSION_SECRET before exposing Purgatory publicly.')
  }
  if (env.ADMIN_PASSWORD === 'change-me') {
    warnings.push('WARNING: ADMIN_PASSWORD is set to the default "change-me". Set a strong ADMIN_PASSWORD before exposing Purgatory publicly.')
  }
  return warnings
}

/** With an https PUBLIC_URL Purgatory is public: default or example secrets are fatal, not warnings. */
export function insecureConfigErrors(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!(env.PUBLIC_URL ?? '').startsWith('https://')) return []
  const errors: string[] = []
  if (env.ADMIN_TOKEN === 'abc123' || env.ADMIN_TOKEN === 'change-me-to-a-strong-secret') {
    errors.push('ADMIN_TOKEN is a default/example value; set a strong random ADMIN_TOKEN.')
  }
  if (!env.SESSION_SECRET || env.SESSION_SECRET === 'change-me-to-a-long-random-string') {
    errors.push('SESSION_SECRET is missing or the example value; set a long random SESSION_SECRET (a generated one would sign everyone out on every restart).')
  }
  if (env.ADMIN_PASSWORD === 'change-me') {
    errors.push('ADMIN_PASSWORD is the example value; set a strong ADMIN_PASSWORD (or leave it empty to disable admin sign-in).')
  }
  return errors
}
