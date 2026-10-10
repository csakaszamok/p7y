import { exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

async function run(cmd: string): Promise<void> {
  const { stderr } = await execAsync(cmd)
  if (stderr) process.stderr.write(stderr)
}

/**
 * Why docker compose rejects this compose text (its schema, value types…), or null when it takes it.
 * Needs no Docker daemon. Warnings (e.g. an unset variable) are not a rejection.
 */
export function composeConfigCheck(text: string, opts: { cwd: string; timeoutMs?: number; command?: string[] }): Promise<string | null> {
  return new Promise(resolve => {
    const [cmd, ...args] = opts.command ?? ['docker', 'compose', '--project-directory', opts.cwd, '-f', '-', 'config', '-q']
    const p = spawn(cmd, args, { cwd: opts.cwd, env: innerCliEnv(process.env), stdio: ['pipe', 'ignore', 'pipe'] })
    let err = ''
    let done = false
    const finish = (v: string | null) => { if (!done) { done = true; clearTimeout(timer); resolve(v) } }
    // e.g. a remote include it tries to fetch: the create must not wait for ever
    const timer = setTimeout(() => { p.kill('SIGKILL'); finish('docker compose config took too long') }, opts.timeoutMs ?? 20_000)
    p.stderr.on('data', d => { err += d })
    p.stdin.on('error', () => {})
    p.on('error', () => finish(null)) // no docker CLI here: the create itself will say so
    p.on('close', code => {
      if (code === 0) return finish(null)
      const lines = err.split('\n').map(l => l.trim()).filter(l => l && !/level=warning|^WARN/i.test(l))
      finish(lines.join(' ').replace(/^validating [^:]*: /, '') || `docker compose config exited with ${code}`)
    })
    p.stdin.end(text)
  })
}

/**
 * The environment for a compose CLI run on a sandbox's stack. Compose fills every ${VAR} it is not
 * given from its own environment, so a compose text written by a user must not see Purgatory's
 * settings (ADMIN_TOKEN, SESSION_SECRET…): only what the CLI itself needs, plus `extra`.
 */
export function innerCliEnv(base: NodeJS.ProcessEnv, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const k of ['PATH', 'HOME', 'DOCKER_CONFIG', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT']) {
    if (base[k] !== undefined) env[k] = base[k] as string
  }
  return { ...env, ...extra }
}

export function composeUp(composePath: string, pull: 'always' | 'missing' | 'never' = 'missing'): Promise<void> {
  return run(`docker compose -f "${composePath}" up -d --pull ${pull}`)
}

/** (Re)creates one service after its config changed; `start: false` leaves it stopped. Other services are not touched. */
export function composeUpService(composePath: string, service: string, start: boolean): Promise<void> {
  return run(`docker compose -f "${composePath}" up ${start ? '-d' : '--no-start'} --no-deps "${service}"`)
}

/** (Re)creates the services whose config changed without starting them. */
export function composeCreate(composePath: string): Promise<void> {
  return run(`docker compose -f "${composePath}" up --no-start`)
}

export function composeStop(composePath: string): Promise<void> {
  return run(`docker compose -f "${composePath}" stop`)
}

export function composeStart(composePath: string): Promise<void> {
  return run(`docker compose -f "${composePath}" start`)
}

export function composeDown(composePath: string): Promise<void> {
  return run(`docker compose -f "${composePath}" down`)
}

/** compose up against the sandbox's own dockerd, retried while it starts; returns how many tries it took. */
export async function composeUpInner(composePath: string, dockerHost: string, certDir: string, projectName?: string,
  opts: { run?: (cmd: string, env: NodeJS.ProcessEnv) => Promise<{ stderr: string }>; sleep?: (ms: number) => Promise<void> } = {}): Promise<number> {
  const run = opts.run ?? ((cmd: string, env: NodeJS.ProcessEnv) => execAsync(cmd, { env }))
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const env = innerCliEnv(process.env, { DOCKER_HOST: dockerHost, DOCKER_TLS_VERIFY: '1', DOCKER_CERT_PATH: certDir })
  const projectFlag = projectName ? `--project-name "${projectName}"` : ''
  const deadline = Date.now() + 90000
  let tries = 0
  while (Date.now() < deadline) {
    tries++
    try {
      const { stderr } = await run(`docker compose -f "${composePath}" ${projectFlag} up -d --pull missing`, env)
      if (stderr) process.stderr.write(stderr)
      return tries
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const transient = msg.includes('Cannot connect') || msg.includes('connection refused') || msg.includes('EOF') || msg.includes('no such host') || msg.includes('lookup ')
      if (!transient) throw err
      // The sandbox's dockerd answers ~1.5 s after its container starts: try again soon, not after 3 s
      await sleep(500)
    }
  }
  throw new Error('Timed out waiting for dind TLS API to accept inner docker compose')
}
