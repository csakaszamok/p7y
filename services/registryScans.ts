import fs from 'fs'
import { Readable } from 'stream'
import { checkName, checkContent, isText, type Finding } from './secretRules'
import { readTarEntries } from './tarReader'
import { issueToken } from './registryAuth'
import { writeFileAtomic } from './atomicWrite'

export type ScanState = 'scanning' | 'clean' | 'flagged' | 'error'
export interface Version { digest: string; state: ScanState; tags: string[]; pushed_at: string; findings: Finding[]; error?: string }
type Store = Record<string, Record<string, Omit<Version, 'digest'>>>
/** One file of an image as the scan sees it: its text (null for binary / too big / deleted). */
export interface ScannedFile { path: string; text: string | null; deleted?: boolean }
/** Walks every file of an image, handing each to onFile as it comes (nothing is kept); stops when signal aborts. */
export type Walk = (repo: string, digest: string, onFile: (f: ScannedFile) => void, signal: AbortSignal) => Promise<string[] | void>

const file = () => process.env.REGISTRY_SCANS_FILE ?? '/app/data/registry-scans.json'
function load(): Store {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')) as Store } catch { return {} }
}
function save(s: Store): void {
  writeFileAtomic(file(), JSON.stringify(s, null, 2))
}

/**
 * A push (tagged, or by digest). Returns whether the version needs a scan: a new or unscanned version is
 * (re)scanned and private meanwhile; one already scanned only gains the tag. A tag that moved leaves its old version.
 */
export function markPushed(repo: string, digest: string, tag?: string): boolean {
  const s = load()
  const versions = (s[repo] ??= {})
  if (tag) for (const [d, v] of Object.entries(versions)) if (d !== digest) v.tags = v.tags.filter(t => t !== tag)
  const known = versions[digest]
  if (known && (known.state === 'clean' || known.state === 'flagged')) {
    if (tag && !known.tags.includes(tag)) known.tags.push(tag)
    save(s)
    return false
  }
  const v = known ?? { state: 'scanning' as ScanState, tags: [], pushed_at: new Date().toISOString(), findings: [] }
  if (tag && !v.tags.includes(tag)) v.tags.push(tag)
  v.state = 'scanning'
  v.findings = []
  delete v.error
  versions[digest] = v
  save(s)
  return true
}

export function versionsOf(repo: string): Version[] {
  return Object.entries(load()[repo] ?? {}).map(([digest, v]) => ({ digest, ...v }))
}

/** The repos of a sandbox (its raw name is the namespace). */
export function reposOf(raw: string): string[] {
  return Object.keys(load()).filter(r => r.startsWith(`${raw}/`)).sort()
}

/** Every version p7y knows of is clean (and there is one). See publicPullAllowed for the registry's side. */
export function repoIsClean(repo: string): boolean {
  const vs = versionsOf(repo)
  return vs.length > 0 && vs.every(v => v.state === 'clean')
}

export function forgetVersion(repo: string, digest: string): void {
  const s = load()
  delete s[repo]?.[digest]
  if (s[repo] && !Object.keys(s[repo]).length) delete s[repo]
  save(s)
}

function setResult(repo: string, digest: string, state: ScanState, findings: Finding[], error?: string): void {
  const s = load()
  const v = s[repo]?.[digest]
  if (!v) return
  v.state = state
  v.findings = findings
  if (error) v.error = error
  else delete v.error
  save(s)
}

const registry = () => process.env.REGISTRY_INTERNAL_URL ?? 'http://registry:5000'
const service = () => `registry.${process.env.HOST_DOMAIN ?? 'lvh.me'}`
const MAX_BYTES = 2 * 1024 ** 3
const MAX_MS = 5 * 60_000
const MANIFEST_TYPES = [
  'application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json',
].join(', ')
const pullAuth = (repo: string) => ({ Authorization: `Bearer ${issueToken('p7y-scanner', service(), [{ type: 'repository', name: repo, actions: ['pull'] }])}` })

/** Every file of every layer, and the config (ENV, labels, history), of each platform of the image. */
const registryWalk: Walk = async (repo, digest, onFile, signal) => {
  const auth = pullAuth(repo)
  type Manifest = { mediaType?: string; manifests?: Array<{ digest: string }>; config?: { digest: string }; layers?: Array<{ digest: string; size: number; mediaType?: string }> }
  const get = async (url: string, accept?: string) => {
    const r = await fetch(`${registry()}/v2/${repo}/${url}`, { headers: { ...auth, ...(accept ? { Accept: accept } : {}) }, signal })
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
    return r
  }
  const manifest = async (d: string) => (await (await get(`manifests/${d}`, MANIFEST_TYPES)).json()) as Manifest
  const root = await manifest(digest)
  // Every platform, and the attestations too: build provenance can carry build arguments
  const images = root.manifests ? root.manifests.map(m => m.digest) : [digest]
  let total = 0, layers = 0
  for (const img of images) {
    const m = img === digest ? root : await manifest(img)
    if (m.manifests) throw new Error('a nested index is not supported')
    // ENV OPENAI_API_KEY=… in a Dockerfile lands in the config, not in a layer
    if (m.config?.digest) onFile({ path: '(image config)', text: await (await get(`blobs/${m.config.digest}`)).text() })
    for (const layer of m.layers ?? []) {
      total += layer.size
      if (total > MAX_BYTES) throw new Error('image larger than 2 GB')
      layers++
      const mt = layer.mediaType ?? 'application/vnd.docker.image.rootfs.diff.tar.gzip'
      if (mt.includes('zstd')) throw new Error('zstd-compressed layers are not supported')
      const r = await get(`blobs/${layer.digest}`)
      if (!r.body) throw new Error(`layer ${layer.digest}: no body`)
      if (mt.includes('tar')) {
        await readTarEntries(Readable.fromWeb(r.body as never), async e => {
          if (e.deleted) { onFile({ path: e.path, text: null, deleted: true }); return }
          const b = await e.read()
          onFile({ path: e.path, text: b && isText(b) ? b.toString('utf8') : null })
        }, { signal, maxBytes: 4 * MAX_BYTES, gzip: mt.includes('gzip') })
      } else {
        // Not a filesystem (an in-toto attestation, an artifact): its own text, up to 1 MB
        const b = Buffer.from(await r.arrayBuffer())
        onFile({ path: `(${mt} ${layer.digest.slice(7, 19)})`, text: b.length <= 1024 * 1024 && isText(b) ? b.toString('utf8') : null })
      }
    }
  }
  // Nothing scanned is not "clean"
  if (!layers) throw new Error('no layers found')
  return root.manifests ? images : []
}

/** Scans one pushed version; the result decides whether its repo may be pulled anonymously. */
export async function scanImage(repo: string, digest: string, deps: { walk?: Walk; timeoutMs?: number } = {}): Promise<void> {
  const findings: Finding[] = []
  const stop = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; stop.abort() }, deps.timeoutMs ?? MAX_MS)
  try {
    const children = await (deps.walk ?? registryWalk)(repo, digest, f => {
      // Each file is checked as it comes and only its findings are kept
      const byName = checkName(f.path)
      if (byName) findings.push({ file: f.path, rule: byName, sample: f.deleted ? '(deleted in a later layer, still in the image)' : '' })
      if (f.text) findings.push(...checkContent(f.path, f.text))
    }, stop.signal)
    if (timedOut) throw new Error('aborted')
    setResult(repo, digest, findings.length ? 'flagged' : 'clean', findings)
    // An index covers its platform and attestation manifests: pushed untagged, they are not versions of their own
    for (const c of children ?? []) if (versionsOf(repo).some(v => v.digest === c && !v.tags.length)) forgetVersion(repo, c)
  } catch (err) {
    setResult(repo, digest, 'error', findings, timedOut ? 'scan took longer than 5 minutes' : err instanceof Error ? err.message : String(err))
  } finally { clearTimeout(timer) }
}

// At most two scans at once: they run inside Purgatory itself
const MAX_PARALLEL = 2
let running = 0
const waiting: Array<() => void> = []
export async function enqueueScan(repo: string, digest: string, deps: { walk?: Walk; timeoutMs?: number } = {}): Promise<void> {
  if (running >= MAX_PARALLEL) await new Promise<void>(r => waiting.push(r))
  running++
  try { await scanImage(repo, digest, deps) } finally { running--; waiting.shift()?.() }
}

/** Scans that were running when Purgatory stopped (left "scanning") run again. */
export async function resumeScans(deps: { walk?: Walk } = {}): Promise<void> {
  const s = load()
  const todo = Object.entries(s).flatMap(([repo, vs]) => Object.entries(vs).filter(([, v]) => v.state === 'scanning').map(([d]) => [repo, d] as const))
  await Promise.all(todo.map(([repo, d]) => enqueueScan(repo, d, deps)))
}

type RegistryDeps = { tags: (repo: string) => Promise<string[]>; digestOf: (repo: string, tag: string) => Promise<string | undefined> }
const registryDeps: RegistryDeps = {
  tags: async repo => {
    const r = await fetch(`${registry()}/v2/${repo}/tags/list`, { headers: pullAuth(repo) })
    if (r.status === 404) return []
    if (!r.ok) throw new Error(`tags: HTTP ${r.status}`)
    return ((await r.json()) as { tags?: string[] | null }).tags ?? []
  },
  digestOf: async (repo, tag) => {
    const r = await fetch(`${registry()}/v2/${repo}/manifests/${tag}`, { method: 'HEAD', headers: { ...pullAuth(repo), Accept: MANIFEST_TYPES } })
    return r.ok ? r.headers.get('docker-content-digest') ?? undefined : undefined
  },
}
const pullCache = new Map<string, { at: number; ok: boolean }>()

/**
 * Anonymous pull of a repo (the registry's tokens are per repo): every version p7y knows is clean, and every tag
 * the registry has points at one of them — a version p7y never heard of (a lost notification) keeps it private.
 * Cached 10 s; any doubt (the registry not answering) is a no.
 */
export async function publicPullAllowed(repo: string, deps: RegistryDeps = registryDeps): Promise<boolean> {
  const hit = pullCache.get(repo)
  if (hit && Date.now() - hit.at < 10_000 && deps === registryDeps) return hit.ok
  let ok = false
  try {
    if (repoIsClean(repo)) {
      const known = new Set(versionsOf(repo).map(v => v.digest))
      const tags = await deps.tags(repo)
      const digests = await Promise.all(tags.map(t => deps.digestOf(repo, t)))
      ok = digests.every(d => d !== undefined && known.has(d))
    }
  } catch { ok = false }
  if (deps === registryDeps) pullCache.set(repo, { at: Date.now(), ok })
  return ok
}
