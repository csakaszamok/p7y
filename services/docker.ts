import crypto from 'node:crypto'
import type { Limits } from './resources'
import fs from 'node:fs'
import { composeDeepSleepAfter } from './sleepSettings'
import { managedLabelFilters, readLabel } from './naming'
import Dockerode from 'dockerode'

const docker = new Dockerode({ socketPath: '/var/run/docker.sock' })

let _hostUsersDir: string | undefined
let _hostSandboxesDir: string | undefined

export function _resetHostUsersDirCache(): void {
  _hostUsersDir = undefined
  _hostSandboxesDir = undefined
}

const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '')

/** The host path of p7y's own mount on `destination`, or null when it cannot be told. */
async function ownMountSource(destination: string): Promise<string | null> {
  try {
    const hostname = fs.readFileSync('/etc/hostname', 'utf8').trim()
    const info = await docker.getContainer(hostname).inspect()
    const mount = (info.Mounts as Array<{ Destination: string; Source: string }>).find(m => m.Destination === destination)
    return mount?.Source ? normalize(mount.Source) : null
  } catch {
    return null
  }
}

/** Host path of the legacy flat sandbox directory (opt/users): read by the startup move only. */
export async function resolveHostUsersDir(): Promise<string> {
  if (_hostUsersDir !== undefined) return _hostUsersDir
  _hostUsersDir = process.env.HOST_USERS_DIR ? normalize(process.env.HOST_USERS_DIR) : (await ownMountSource('/opt/users')) ?? '/opt/users'
  return _hostUsersDir
}

/**
 * Host path of opt/sandboxes, which the sandboxes' bind mounts point into: HOST_SANDBOXES_DIR, else the source of
 * p7y's mount on /opt/sandboxes, else the sibling `sandboxes` of a set HOST_USERS_DIR, else /opt/sandboxes
 * (= cannot tell: the migrations that rewrite host paths then do nothing).
 */
export async function resolveHostSandboxesDir(): Promise<string> {
  if (_hostSandboxesDir !== undefined) return _hostSandboxesDir
  const fromEnv = process.env.HOST_SANDBOXES_DIR ? normalize(process.env.HOST_SANDBOXES_DIR) : null
  const sibling = process.env.HOST_USERS_DIR ? `${normalize(process.env.HOST_USERS_DIR).replace(/\/[^/]*$/, '')}/sandboxes` : null
  _hostSandboxesDir = fromEnv ?? (await ownMountSource('/opt/sandboxes')) ?? sibling ?? '/opt/sandboxes'
  return _hostSandboxesDir
}

export async function getContainerIdByName(name: string): Promise<string> {
  const info = await docker.getContainer(name).inspect()
  return info.Id
}

export async function getContainerStatus(containerId: string): Promise<string> {
  const info = await docker.getContainer(containerId).inspect()
  return info.State.Status
}

export interface SandboxMeta {
  name: string
  template: string
  /** p7y.runtime label; "" for sandboxes created before runtimes existed */
  runtime: string
  /** p7y.compose label: "edited" when created from a changed or pasted compose text */
  compose: 'template' | 'edited'
  /** p7y.ssh label: created with an sshd (root, key only) */
  ssh: boolean
  owner: string
  status: string
  container_id: string
  created_at: string
  /** Set when the container is not running because its last start failed (Docker's State.Error) */
  start_error?: string
}

/** Why a stopped container's last start failed, or undefined. */
async function startError(containerId: string): Promise<string | undefined> {
  try {
    const error = (await docker.getContainer(containerId).inspect()).State.Error
    return error || undefined
  } catch {
    return undefined
  }
}

export async function listManagedContainers(): Promise<SandboxMeta[]> {
  // One query per label namespace (p7y.* and legacy leander.*): Docker ANDs label filters.
  const lists = await Promise.all(managedLabelFilters().map(label => docker.listContainers({ all: true, filters: { label: [label] } })))
  const seen = new Set<string>()
  return Promise.all(lists.flat().filter(c => !seen.has(c.Id) && seen.add(c.Id)).map(async c => {
    const meta: SandboxMeta = {
      name: readLabel(c.Labels, 'name') ?? c.Names[0].replace(/^\//, ''),
      template: readLabel(c.Labels, 'template') ?? '',
      runtime: readLabel(c.Labels, 'runtime') ?? '',
      compose: readLabel(c.Labels, 'compose') === 'edited' ? 'edited' : 'template',
      ssh: readLabel(c.Labels, 'ssh') === 'true',
      owner: readLabel(c.Labels, 'owner') ?? 'admin',
      status: c.State,
      container_id: c.Id,
      created_at: readLabel(c.Labels, 'created_at') ?? ''
    }
    // An asleep sandbox and one that cannot start look the same in the list: tell them apart
    if (c.State !== 'running') {
      const error = await startError(c.Id)
      if (error) meta.start_error = error
    }
    return meta
  }))
}

export interface SandboxState {
  name: string
  status: string
  finishedAt: string
  deepSleepAfter: string | undefined
  /** Attached to a network that no longer exists (e.g. traefik-net re-created): it cannot start again. */
  staleNetwork: boolean
  /** Why the last start failed (Docker's State.Error), empty if it did not */
  error: string
  /** When the container last started (Docker's State.StartedAt) */
  startedAt?: string
}

/** Current container state of a sandbox, or null if its container does not exist. */
export async function getSandboxState(name: string): Promise<SandboxState | null> {
  try {
    const info = await docker.getContainer(name).inspect()
    const attached = Object.values(info.NetworkSettings?.Networks ?? {}).map(n => n.NetworkID).filter(Boolean)
    const existing = attached.length ? new Set((await docker.listNetworks()).map(n => n.Id)) : new Set<string>()
    return {
      name,
      status: info.State.Status,
      finishedAt: info.State.FinishedAt,
      // The compose file is the source of truth (PATCH changes it without recreating the container)
      deepSleepAfter: composeDeepSleepAfter(name) ?? readLabel(info.Config.Labels, 'deep_sleep_after'),
      staleNetwork: attached.some(id => !existing.has(id)),
      error: info.State.Error ?? '',
      startedAt: info.State.StartedAt
    }
  } catch {
    return null
  }
}

/** A root shell in the sandbox container (bash if there is one), with a TTY, for the browser terminal. */
export async function openShell(name: string, cols: number, rows: number) {
  const container = docker.getContainer(name)
  // The shell notes its pid (exec keeps it): Docker does not end an exec's process when its connection
  // goes, so closing the terminal HUPs that process group with a second exec
  const pidFile = `/tmp/.p7y-term-${crypto.randomUUID()}`
  const exec = await container.exec({
    Cmd: ['sh', '-c', `echo $$ > ${pidFile}; command -v bash >/dev/null && exec bash -l || exec sh -l`],
    AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: true,
    Env: ['TERM=xterm-256color', 'HOME=/root'], WorkingDir: '/root',
  })
  const stream = await exec.start({ hijack: true, stdin: true, Tty: true }) as unknown as NodeJS.ReadWriteStream
  await exec.resize({ h: rows, w: cols }).catch(() => {})
  return {
    stream,
    resize: (c: number, r: number) => exec.resize({ h: r, w: c }).then(() => {}, () => {}),
    exitCode: async () => (await exec.inspect()).ExitCode ?? null,
    kill: async () => {
      const k = await container.exec({ Cmd: ['sh', '-c', `p=$(cat ${pidFile} 2>/dev/null) && { kill -HUP -- -$p $p 2>/dev/null; true; }; rm -f ${pidFile}`] })
      await k.start({ Detach: true })
    },
  }
}

export type DockerStats = {
  cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number; online_cpus?: number }
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number }
  memory_stats: { usage?: number; limit?: number; stats?: Record<string, number> }
}

/** Change a sandbox container's limits in place: no restart. */
export async function updateResources(name: string, limits: Limits): Promise<void> {
  await docker.getContainer(name).update({ NanoCpus: Math.round(limits.cpus * 1e9), Memory: limits.memory, MemorySwap: limits.memory })
}

/** One stats sample (Docker waits for a second reading, so precpu_stats is filled in). */
export async function containerStats(name: string): Promise<DockerStats> {
  return await docker.getContainer(name).stats({ stream: false }) as unknown as DockerStats
}

let hostSize: Limits | undefined
/** The OCI runtimes the host's Docker knows (runc, and sysbox-runc where sysbox is installed). */
export async function dockerRuntimes(): Promise<string[]> {
  return Object.keys((await docker.info()).Runtimes ?? {})
}

/** The host's size: how far the admin may raise a sandbox's limits. */
export async function hostResources(): Promise<Limits> {
  if (!hostSize) {
    const i = await docker.info()
    hostSize = { cpus: i.NCPU, memory: i.MemTotal }
  }
  return hostSize
}
