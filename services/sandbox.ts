import { publicUrl } from './session'
import { frpsToml, newFrpsApiPassword } from './frpsApi'
import { createStepTimer } from './stepTimer'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import crypto from 'node:crypto'
import vm from 'node:vm'
import bcrypt from 'bcryptjs'
import { generateCertBundle } from './tls'
import { loadTemplate } from './templateLoader'
import { loadRuntime } from './runtimeLoader'
import { appEntriesOffline, appHostsFromCompose } from './appUrls'
import { waitForTunnels } from './tunnelWait'
import { appLinks, frpsDomains, rememberedApps } from './appLinks'
import { primeSablierSession, markWoken, markCreating, creatingDone } from './wake'
import { writeAuthorizedKeys, createGeneratedKey } from './sandboxSsh'
import { sshKeysOf } from './sshKeys'
import { resourceDefaults, memoryForCompose, type Limits } from './resources'
import { sandboxName, rawNameOf, readLabel } from './naming'
import { sessionDurationOf } from './sleepSettings'
import { listManagedContainers, resolveHostSandboxesDir, type SandboxMeta } from './docker'
import { sandboxDir, legacyUsersDir, listSandboxDirs, newSandboxDir, archiveRoot, ownerDirName, ownerOfCompose, sandboxesDir, forgetSandboxDir, sandboxesMounted, SANDBOX_NAME } from './sandboxPaths'
import { composeUp, composeStop, composeStart, composeDown, composeUpInner, composeConfigCheck } from './compose'
import { hashPassword } from './registryAuth'
import { listProjectVolumes, exportVolume, removeVolume, stopProjectContainers, removeProjectContainers } from './project'

/** The sandbox's directory; for an unknown one a path that does not exist (reads then fail as before). */
const dirOf = (name: string) => sandboxDir(name) ?? `${legacyUsersDir()}/${name}`

/** Removes an owner directory its last sandbox has left. */
function removeEmptyOwnerDir(dir: string): void {
  const parent = path.posix.dirname(dir)
  if (path.posix.dirname(parent) !== sandboxesDir()) return
  try { if (fs.readdirSync(parent).length === 0) fs.rmdirSync(parent) } catch { /* gone or not empty */ }
}

export interface SandboxInfo extends SandboxMeta {
  ca_cert: string
  client_cert: string
  client_key: string
  /** host → compose service, for a sandbox that is not running (not sent by the API) */
  app_services?: Record<string, string>
  tunnel_urls: string[]
  extras: Record<string, string>
}

export interface CreateSandboxResult {
  name: string
  docker_host: string
  ca_cert: string
  client_cert: string
  client_key: string
  tunnel_urls: string[]
  registry_url: string
  registry_username: string
  registry_password: string
  extras: Record<string, string>
  /** The sandbox's generated SSH private key (SSH runtimes only); also GET /sandboxes/:name/ssh-key */
  ssh_private_key?: string
}

/** ${key} → value; a $ in a value becomes $$ so docker compose keeps it literal. */
function applyVarsText(text: string, vars: Record<string, string>): string {
  let str = text
  for (const [key, value] of Object.entries(vars)) {
    str = str.split(`\${${key}}`).join(value.replace(/\$/g, '$$$$'))
  }
  return str
}

function applyVars(composeObj: Record<string, unknown>, vars: Record<string, string>): string {
  return applyVarsText(yaml.dump(composeObj, { lineWidth: -1 }), vars)
}


async function runBeforeScript(
  script: string,
  ctx: { name: string; rawName: string; hostDomain: string; scheme: string }
): Promise<Record<string, string>> {
  const context = vm.createContext({ crypto, fs, path, bcrypt, ...ctx, console })
  const result = await vm.runInNewContext(`(async () => { ${script} })()`, context) as unknown
  return result && typeof result === 'object' ? result as Record<string, string> : {}
}

function removeDynamicConfig(name: string): void {
  const dir = process.env.TRAEFIK_DYNAMIC_DIR ?? '/app/traefik-dynamic'
  const file = path.join(dir, `sandbox-${name}.yml`)
  try { fs.unlinkSync(file) } catch { /* already gone */ }
}

function readClientCerts(name: string): { ca_cert: string; client_cert: string; client_key: string } {
  return {
    ca_cert: fs.readFileSync(`${dirOf(name)}/certs/server/ca.pem`, 'utf8'),
    client_cert: fs.readFileSync(`${dirOf(name)}/certs/client/cert.pem`, 'utf8'),
    client_key: fs.readFileSync(`${dirOf(name)}/certs/client/key.pem`, 'utf8')
  }
}

/**
 * Sablier only puts a sandbox to sleep once it has a session, and only an HTTP request through
 * the sandbox router opens one. Opened here after every start, in the background, so a sandbox
 * nobody has opened yet still counts down and sleeps after its idle timeout.
 */
function openSleepSession(name: string): void {
  // Up to 2.5 min: the router appears only once socat is healthy (the tunnel is up), which can take a while
  primeSablierSession(name, 150).catch(() => {})
}

/** The sandbox's dockerd settings: the Docker Hub cache, and the p7y registry as an insecure registry (reached
 * through Traefik on the internal network, whose public certificate the sandbox cannot verify). */
export function daemonJson(hostDomain: string, runtimeDaemonJson: Record<string, unknown> = {}): string {
  const cacheHost = process.env.REGISTRY_CACHE_HOST ?? 'registry-cache:5000'
  return JSON.stringify({ 'registry-mirrors': [`http://${cacheHost}`], 'insecure-registries': [cacheHost, `registry.${hostDomain}`], ...runtimeDaemonJson }, null, 2)
}


/** Sandbox dir with a compose file but no containers = deep sleep. Template info comes from the compose labels. */
function deepSleepMeta(name: string): SandboxMeta | null {
  if (!SANDBOX_NAME.test(name)) return null
  const composePath = `${dirOf(name)}/docker-compose.yml`
  if (!fs.existsSync(composePath)) return null
  let labels: Record<string, string> = {}
  try {
    const compose = yaml.load(fs.readFileSync(composePath, 'utf8')) as { services?: { sandbox?: { labels?: Record<string, string> } } } | null
    labels = compose?.services?.sandbox?.labels ?? {}
  } catch { /* unreadable compose: report without template info */ }
  return { name, template: readLabel(labels, 'template') ?? '', runtime: readLabel(labels, 'runtime') ?? '', compose: readLabel(labels, 'compose') === 'edited' ? 'edited' : 'template', ssh: readLabel(labels, 'ssh') === 'true', owner: readLabel(labels, 'owner') ?? 'admin', status: 'deep_sleep', container_id: '', created_at: readLabel(labels, 'created_at') ?? '' }
}

function deepSleepingSandboxes(live: SandboxMeta[]): SandboxMeta[] {
  const liveNames = new Set(live.map(s => s.name))
  return listSandboxDirs().map(e => e.name)
    .filter(n => !liveNames.has(n))
    .map(deepSleepMeta)
    .filter((m): m is SandboxMeta => m !== null)
}

/**
 * Raw (unprefixed) names of every sandbox that currently exists, live or
 * deep-sleeping, current p7y- and legacy leander- alike (URLs are built from
 * the raw name), so createSandbox can check a new raw name against them.
 */
function existingRawNames(containers: SandboxMeta[]): Set<string> {
  const names = new Set<string>()
  const add = (n: string) => { const raw = rawNameOf(n); if (raw) names.add(raw) }
  for (const c of containers) add(c.name)
  for (const e of listSandboxDirs()) add(e.name)
  return names
}

/**
 * Traefik's sandbox router is HostRegexp(`^${raw_name}-[a-z0-9-]+[.]domain$`),
 * and Traefik prefers the longer/more specific rule. So if raw name R is a
 * strict prefix of an existing raw name E (or vice versa) followed by '-',
 * one sandbox's router would also match the other's hosts and hijack its
 * traffic. Returns the conflicting existing raw name, or null if none.
 */
function conflictingRawName(rawName: string, existingNames: Set<string>): string | null {
  for (const e of existingNames) {
    if (e === rawName) continue
    if (rawName.startsWith(`${e}-`) || e.startsWith(`${rawName}-`)) return e
  }
  return null
}

/**
 * The apps of a sandbox that is not running, for its details and the list: only a running sandbox has a tunnel
 * to ask (a stopped one's frps host does not resolve: seconds of DNS timeout). The apps it had when it last ran,
 * or (never seen running) those of the inner compose file; opening one wakes the sandbox.
 */
function offlineApps(meta: SandboxMeta): Array<{ host: string; service: string }> {
  const innerProject = () => { try { return loadTemplate(meta.template).inner_project_name } catch { return undefined } }
  return rememberedApps(meta.name)?.map(l => ({ host: l.url, service: l.service }))
    ?? appEntriesOffline(meta.name, dirOf(meta.name), process.env.HOST_DOMAIN ?? 'lvh.me', innerProject)
}

export const sandboxService = {
  /** Creates a sandbox; while it does, a request to its address waits instead of starting it (wake.ts). */
  async createSandbox(rawName: string, createInnerStack = true, idleTimeout?: string, deepSleepAfter?: string, owner = 'admin', templateName?: string, runtimeName?: string, customCompose?: string, sshKeys?: string[], limits?: Limits): Promise<CreateSandboxResult> {
    const name = sandboxName(rawName)
    const marked = markCreating(name)
    try {
      return await this.createSandboxUnmarked(rawName, createInnerStack, idleTimeout, deepSleepAfter, owner, templateName, runtimeName, customCompose, sshKeys, limits)
    } finally {
      if (marked) creatingDone(name)
    }
  },

  async createSandboxUnmarked(rawName: string, createInnerStack = true, idleTimeout?: string, deepSleepAfter?: string, owner = 'admin', templateName?: string, runtimeName?: string, customCompose?: string, sshKeys?: string[], limits?: Limits): Promise<CreateSandboxResult> {
    // || : an empty variable (DEFAULT_TEMPLATE= in .env) means unset, as in POST /sandboxes
    const resolvedTemplateName = templateName ?? (process.env.DEFAULT_TEMPLATE || 'starter')
    const resolvedRuntimeName = runtimeName ?? await (await import('./defaultRuntime')).defaultRuntime()
    const hostAddress = process.env.HOST_ADDRESS ?? '127.0.0.1'
    const hostDomain = process.env.HOST_DOMAIN ?? 'lvh.me'
    const registryUrl = `registry.${hostDomain}`
    const name = sandboxName(rawName)
    // One line at the end says where the time went
    const timer = createStepTimer()

    if (sandboxDir(name) !== null) throw new Error(`Sandbox already exists: ${name}`)
    if (!sandboxesMounted()) throw new Error('opt/sandboxes is not mounted from the host (see docker-compose.yml): a sandbox created now would be lost')
    const dir = newSandboxDir(owner, name)
    const existing = await listManagedContainers()
    const rawNames = existingRawNames(existing)
    // Same raw name under another prefix (e.g. a legacy leander-<raw>) would share every URL.
    if (rawNames.has(rawName)) throw new Error(`Sandbox already exists: ${rawName}`)

    const conflict = conflictingRawName(rawName, rawNames)
    if (conflict) {
      throw new Error(`Sandbox name "${rawName}" conflicts with an existing sandbox: ${conflict}`)
    }

    // Both before anything is written: an unknown name must not leave a half-made sandbox dir behind
    const runtime = loadRuntime(resolvedRuntimeName)
    const template = loadTemplate(resolvedTemplateName)
    // Same for the SSH key store, which authorized_keys is written from below
    try { sshKeysOf(owner) } catch (err) {
      throw new Error(`SSH key store unreadable (data/ssh-keys.json): ${err instanceof Error ? err.message : err}`)
    }

    const services = (runtime.docker_compose.services ?? {}) as Record<string, unknown>
    const hasFrps = 'frps' in services

    // <raw>-docker.<domain>: where a Docker CLI reaches this dockerd through the gateway (TLS passed through)
    timer.lap('checks')
    const certs = generateCertBundle(hostAddress, name, 2048, [`${rawName}-docker.${hostDomain}`])
    timer.lap('certificates')
    const createdAt = new Date().toISOString()
    const hostSandboxesDir = await resolveHostSandboxesDir()

    const serverCertsDir = `${dir}/certs/server`
    const clientCertsDir = `${dir}/certs/client`
    fs.mkdirSync(serverCertsDir, { recursive: true })
    fs.mkdirSync(clientCertsDir, { recursive: true })
    fs.writeFileSync(path.join(serverCertsDir, 'ca.pem'), certs.caCert)
    fs.writeFileSync(path.join(serverCertsDir, 'cert.pem'), certs.serverCert)
    fs.writeFileSync(path.join(serverCertsDir, 'key.pem'), certs.serverKey)
    fs.writeFileSync(path.join(clientCertsDir, 'cert.pem'), certs.clientCert)
    fs.writeFileSync(path.join(clientCertsDir, 'key.pem'), certs.clientKey)
    fs.writeFileSync(path.join(clientCertsDir, 'ca.pem'), certs.caCert)

    fs.writeFileSync(`${dir}/instance-name`, rawName)
    fs.mkdirSync(`${dir}/inner`, { recursive: true })
    fs.writeFileSync(`${dir}/daemon.json`, daemonJson(hostDomain, runtime.daemon_json))

    const frpToken = crypto.randomBytes(16).toString('hex')
    const frpsApiPassword = newFrpsApiPassword()
    if (hasFrps) fs.writeFileSync(`${dir}/frps.toml`, frpsToml(frpToken, frpsApiPassword))

    const vars: Record<string, string> = {
      name,
      raw_name: rawName,
      runtime_name: runtime.name,
      template_name: template.name,
      compose_source: customCompose === undefined ? 'template' : 'edited',
      created_at: createdAt,
      // ${host_users_dir}/${name} (custom runtimes) and ${sandbox_dir} both name the sandbox's own directory
      host_users_dir: `${hostSandboxesDir}/${ownerDirName(owner)}`,
      sandbox_dir: `${hostSandboxesDir}/${ownerDirName(owner)}/${name}`,
      host_domain: hostDomain,
      frp_token: frpToken,
      frps_api_auth: `p7y:${frpsApiPassword}`,
      idle_timeout: sessionDurationOf(idleTimeout ?? template.idle_timeout ?? '30m'),
      deep_sleep_after: deepSleepAfter ?? template.deep_sleep_after ?? '7d',
      owner: JSON.stringify(owner),
      cpus: String((limits ?? resourceDefaults().limits).cpus),
      memory: memoryForCompose((limits ?? resourceDefaults().limits).memory),
    }
    const registryPassword = crypto.randomBytes(16).toString('hex')
    fs.writeFileSync(`${dir}/registry.hash`, await hashPassword(registryPassword))
    timer.lap('files')

    let extras: Record<string, string> = {}
    if (createInnerStack && template.before_script) {
      extras = await runBeforeScript(template.before_script, { name, rawName, hostDomain, scheme: publicUrl().startsWith('https://') ? 'https' : 'http' })
      Object.assign(vars, extras)
    }

    fs.writeFileSync(`${dir}/docker-compose.yml`, applyVars(runtime.docker_compose, vars))
    let innerText: string | undefined
    if (createInnerStack) {
      // A given compose text keeps its own comments and layout; the template's goes through yaml.dump as before
      const inner = customCompose === undefined ? applyVars(template.compose, vars) : applyVarsText(customCompose, vars)
      // A given text is checked by docker compose itself before anything starts: a schema error found
      // by the inner compose up would leave a half-made sandbox (outer containers up) holding the name
      if (customCompose !== undefined) {
        const problem = await composeConfigCheck(inner, { cwd: `${dir}/inner` })
        if (problem) {
          fs.rmSync(dir, { recursive: true, force: true })
          removeEmptyOwnerDir(dir)
          throw new Error(`compose is not a valid compose file: ${problem}`)
        }
      }
      fs.writeFileSync(`${dir}/inner/docker-compose.yml`, inner)
      innerText = inner
    }

    // SSH (foxglove sshd reads these): host keys survive re-creation; authorized_keys must exist as a
    // file before compose up, or Docker would create a directory in its place
    fs.mkdirSync(`${dir}/ssh-host-keys`, { recursive: true })
    if (sshKeys?.length) fs.writeFileSync(`${dir}/ssh-extra-keys`, sshKeys.map(k => `${k}\n`).join(''))
    writeAuthorizedKeys(name, owner)
    const runtimeLabels = ((runtime.docker_compose.services as Record<string, { labels?: Record<string, string> }> | undefined)?.sandbox?.labels) ?? {}
    const sshPrivateKey = String(runtimeLabels['p7y.ssh']) === 'true' ? createGeneratedKey(name, owner) : undefined

    timer.lap('prepare')
    await composeUp(`${dir}/docker-compose.yml`)
    timer.lap('compose up')

    if (createInnerStack) {
      const tries = await composeUpInner(`${dir}/inner/docker-compose.yml`, `tcp://${name}:2376`, clientCertsDir, template.inner_project_name ?? 'inner')
      timer.lap('inner stack', tries > 1 ? `${tries} tries` : undefined)
    }

    let tunnelUrls: string[] = []
    if (hasFrps && createInnerStack) {
      // Done as soon as frps serves every app the inner compose publishes (not on fixed 3 s polls)
      const expected = innerText === undefined ? [] : appHostsFromCompose(innerText, { instance: rawName, project: template.inner_project_name ?? 'inner', domain: hostDomain })
      tunnelUrls = await waitForTunnels(() => frpsDomains(name), expected)
      // What frpc registered, minus ports bound to 127.0.0.1 (private to the sandbox)
      if (tunnelUrls.length) { const seen = tunnelUrls; tunnelUrls = (await appLinks(name, {}, seen)).map(l => l.url) }
      timer.lap('tunnel')
    }

    fs.writeFileSync(`${dir}/extras.json`, JSON.stringify(extras))
    // Answer once its router is there (the request that opens the Sablier session goes through it): its app links
    // work then, instead of landing on the waiting page. Not there within ~10 s: the session is opened in the background.
    if (!await primeSablierSession(name, 40, 250).catch(() => false)) openSleepSession(name)
    timer.lap('router')
    console.log(`[create] ${name} ready in ${timer.summary()}`)

    return {
      name,
      docker_host: '',
      ca_cert: certs.caCert,
      client_cert: certs.clientCert,
      client_key: certs.clientKey,
      tunnel_urls: tunnelUrls,
      registry_url: registryUrl,
      registry_username: rawName,
      registry_password: registryPassword,
      extras,
      ...(sshPrivateKey ? { ssh_private_key: sshPrivateKey } : {}),
    }
  },

  async listSandboxes(): Promise<Array<SandboxMeta & { tunnel_urls: string[] }>> {
    const live = await listManagedContainers()
    const running = await Promise.all(
      live.map(async meta => ({
        ...meta,
        tunnel_urls: !fs.existsSync(`${dirOf(meta.name)}/frps.toml`) ? []
          : meta.status === 'running' ? (await appLinks(meta.name)).map(l => l.url)
          : offlineApps(meta).map(e => e.host)
      }))
    )
    return [...running, ...deepSleepingSandboxes(live).map(meta => ({ ...meta, tunnel_urls: fs.existsSync(`${dirOf(meta.name)}/frps.toml`) ? offlineApps(meta).map(e => e.host) : [] }))]
  },

  async getSandbox(name: string): Promise<SandboxInfo> {
    const containers = await listManagedContainers()
    const meta = containers.find(c => c.name === name) ?? deepSleepMeta(name)
    if (!meta) throw new Error(`Sandbox not found: ${name}`)
    const certs = readClientCerts(name)
    const hasFrps = fs.existsSync(`${dirOf(name)}/frps.toml`)
    const offline = hasFrps && meta.status !== 'running' ? offlineApps(meta) : []
    const tunnel_urls = !hasFrps ? []
      : meta.status === 'running' ? (await appLinks(name)).map(l => l.url)
      : offline.map(e => e.host)
    const extras = fs.existsSync(`${dirOf(name)}/extras.json`)
      ? JSON.parse(fs.readFileSync(`${dirOf(name)}/extras.json`, 'utf8')) as Record<string, string>
      : {}
    return { ...meta, ...certs, tunnel_urls, extras, ...(offline.length ? { app_services: Object.fromEntries(offline.map(e => [e.host, e.service])) } : {}) }
  },

  async refreshStatus(name: string): Promise<SandboxInfo> {
    return this.getSandbox(name)
  },

  async stopSandbox(name: string): Promise<void> {
    await this.getSandbox(name)
    await composeStop(`${dirOf(name)}/docker-compose.yml`)
    removeDynamicConfig(name)
  },

  /**
   * Wakes a sandbox. Asleep or in deep sleep it takes a running slot (and from deep sleep a slot): refused at
   * the owner's limit (code LIMIT). `sleep`: one of the owner's running sandboxes to put to sleep first (a swap).
   */
  async startSandbox(name: string, opts: { sleep?: string } = {}): Promise<void> {
    const sandbox = await this.getSandbox(name)
    const composePath = `${dirOf(name)}/docker-compose.yml`
    if (sandbox.status === 'running') { await composeStart(composePath); openSleepSession(name); return }
    if (opts.sleep) {
      const other = opts.sleep === name ? null : await this.getSandbox(opts.sleep).catch(() => null)
      if (!other || other.owner !== sandbox.owner || other.status !== 'running') {
        throw Object.assign(new Error(`${opts.sleep} is not another running sandbox of the same owner`), { code: 'BAD_SWAP' })
      }
    }
    const { reserveWake } = await import('./quota')
    // A swap reserves first, counting the one to sleep as gone: nothing is put to sleep for a wake that would be refused
    const slot = opts.sleep ? await reserveWake(sandbox.owner, name, sandbox.status, opts.sleep) : await reserveWake(sandbox.owner, name, sandbox.status)
    if (!slot.ok) throw Object.assign(new Error(slot.refusal.message), { code: 'LIMIT', refusal: slot.refusal })
    try {
      if (opts.sleep) await this.stopSandbox(opts.sleep)
      // Its address reaches p7y until the router is back: a waiting page, not "does not reach the sandbox"
      markWoken(name)
      // Deep sleep removed the containers: recreate them instead of starting
      if (sandbox.status === 'deep_sleep') await composeUp(composePath)
      else await composeStart(composePath)
    } finally { slot.release() }
    markWoken(name)
    openSleepSession(name)
  },

  async restartSandbox(name: string): Promise<void> {
    const sandbox = await this.getSandbox(name)
    // Restarting a stopped sandbox wakes it: within the owner's limits, like any wake
    if (sandbox.status !== 'running') return this.startSandbox(name)
    markWoken(name) // while it restarts, its address reaches p7y: a waiting page
    await composeStop(`${dirOf(name)}/docker-compose.yml`)
    await composeStart(`${dirOf(name)}/docker-compose.yml`)
    markWoken(name)
    openSleepSession(name)
  },

  /**
   * Explicit delete: nothing is destroyed until the sandbox's volumes and
   * config are safely in /opt/archive. Stop (not down) first so a failed
   * archive leaves containers Sablier can still wake. Containers are found by
   * compose project label, so sandboxes without a compose file (created by
   * older versions) are handled too. Returns the archive dir.
   */
  async archiveSandbox(name: string): Promise<string> {
    if (!SANDBOX_NAME.test(name)) throw new Error(`Invalid sandbox name: ${name}`)
    const dir = dirOf(name)
    if (!fs.existsSync(dir)) throw new Error(`Sandbox not found: ${name}`)
    const composePath = `${dir}/docker-compose.yml`
    const hasCompose = fs.existsSync(composePath)
    // In deep sleep there are no containers to read labels from: the compose file has the same ones
    const meta = (await listManagedContainers()).find(c => c.name === name) ?? deepSleepMeta(name)

    await stopProjectContainers(name)

    const archivedAt = new Date()
    let owner = meta?.owner
    if (!owner) { try { owner = ownerOfCompose(fs.readFileSync(composePath, 'utf8')) } catch { owner = 'admin' } }
    const dest = `${archiveRoot(owner)}/${name}-${archivedAt.toISOString().replace(/[:.]/g, '-')}`
    const volumes = await listProjectVolumes(name)
    fs.mkdirSync(`${dest}/volumes`, { recursive: true })
    for (const volume of volumes) await exportVolume(volume, `${dest}/volumes/${volume}.tar.gz`)
    fs.cpSync(dir, `${dest}/config`, { recursive: true })
    fs.writeFileSync(`${dest}/manifest.json`, JSON.stringify({
      name,
      owner,
      template: meta?.template ?? null,
      runtime: meta?.runtime || null,
      created_at: meta?.created_at ?? null,
      archived_at: archivedAt.toISOString(),
      volumes
    }, null, 2))

    // Archive is complete — only now remove the live sandbox.
    if (hasCompose) await composeDown(composePath)
    await removeProjectContainers(name)
    for (const volume of volumes) await removeVolume(volume)
    fs.rmSync(dir, { recursive: true, force: true })
    forgetSandboxDir(name)
    removeEmptyOwnerDir(dir)
    removeDynamicConfig(name)
    return dest
  }
}
