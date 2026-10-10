// The Files tab: browse, upload and download a sandbox's own files, in the folders that outlive a deep sleep
// (they are volumes; anything else in the sandbox container is gone when it is recreated).
import path from 'node:path'
import { tarFile, firstFile } from './tar'
import { parseMemory } from './resources'

export const FILE_ROOTS = ['/root', '/home', '/srv', '/opt']
const ROOTS_TEXT = '/root, /home, /srv and /opt'
export const TEXT_MAX = 1024 * 1024

/** A normalized absolute path inside one of FILE_ROOTS, or an error. */
export function safePath(p: string): string {
  const n = p.startsWith('/') ? path.posix.normalize(p).replace(/(.)\/+$/, '$1') : ''
  if (!FILE_ROOTS.some(r => n === r || n.startsWith(`${r}/`))) throw new Error(`Only ${ROOTS_TEXT} are kept (and shown): ${p || '(no path)'}`)
  return n
}

export interface FileEntry { name: string; type: 'dir' | 'file' | 'link' | 'other'; size: number; mtime: string }

const typeOf = (t: string): FileEntry['type'] => t === 'directory' ? 'dir' : t.startsWith('regular') ? 'file' : t === 'symbolic link' ? 'link' : 'other'

/** `stat -c '%F<tab>%s<tab>%Y<tab>%n'` lines → entries, folders first, then by name. */
export function parseListing(out: string): FileEntry[] {
  const entries = out.split('\n').filter(Boolean).map(line => {
    const [t, size, mtime, ...name] = line.split('\t')
    return { name: name.join('\t'), type: typeOf(t), size: Number(size), mtime: new Date(Number(mtime) * 1000).toISOString() }
  })
  const rank = (e: FileEntry) => e.type === 'dir' ? 0 : 1
  return entries.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

// The path is always "$1", never put into the script: a name can hold any character
const LIST = `cd -- "$1" 2>/dev/null || { [ -e "$1" ] && exit 4; exit 3; }
for f in * .*; do
  case "$f" in .|..) continue ;; esac
  { [ -e "$f" ] || [ -L "$f" ]; } && stat -c '%F\t%s\t%Y\t%n' -- "$f"
done
exit 0`
const STAT = `stat -c '%F\t%s' -- "$1"`
const sh = (script: string, arg: string) => ['sh', '-c', script, 'sh', arg]

export interface ExecResult { code: number; stdout: string; stderr: string }
export interface FilesDeps {
  exec: (name: string, cmd: string[]) => Promise<ExecResult>
  getArchive: (name: string, path: string) => Promise<AsyncIterable<Uint8Array>>
  putArchive: (name: string, dir: string, tar: Buffer) => Promise<void>
}

export function createSandboxFiles(deps: FilesDeps) {
  async function stat(name: string, p: string): Promise<{ type: FileEntry['type']; size: number }> {
    const r = await deps.exec(name, sh(STAT, p))
    if (r.code !== 0) throw new Error(`No such file or folder: ${p}`)
    const [t, size] = r.stdout.trim().split('\t')
    return { type: typeOf(t), size: Number(size) }
  }
  async function fileBytes(name: string, p: string): Promise<AsyncIterable<Uint8Array>> {
    const f = await firstFile(await deps.getArchive(name, p))
    if (!f) throw new Error(`Not a file: ${p}`)
    return f.body
  }

  return {
    async list(name: string, p: string): Promise<FileEntry[]> {
      const r = await deps.exec(name, sh(LIST, p))
      if (r.code === 3) throw new Error(`No such folder: ${p}`)
      if (r.code === 4) throw new Error(`Not a folder: ${p}`)
      if (r.code !== 0) throw new Error(r.stderr.trim() || `Could not list ${p}`)
      return parseListing(r.stdout)
    },

    /** A file's bytes, or a folder as a tar archive. */
    async download(name: string, p: string): Promise<{ kind: 'file' | 'dir'; size: number | null; body: AsyncIterable<Uint8Array> }> {
      const s = await stat(name, p)
      if (s.type === 'dir') return { kind: 'dir', size: null, body: await deps.getArchive(name, p) }
      if (s.type !== 'file') throw new Error(`Not a file or folder: ${p}`)
      return { kind: 'file', size: s.size, body: await fileBytes(name, p) }
    },

    async readText(name: string, p: string): Promise<string> {
      const s = await stat(name, p)
      if (s.type === 'dir') throw new Error(`A folder: ${p}`)
      if (s.size > TEXT_MAX) throw new Error(`Too big to read as text (over 1 MB): ${p}`)
      const parts: Buffer[] = []
      for await (const c of await fileBytes(name, p)) parts.push(Buffer.from(c))
      const bytes = Buffer.concat(parts)
      try {
        if (bytes.includes(0)) throw new Error('binary')
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch { throw new Error(`Not a text file: ${p}`) }
    },

    /** Writes (or replaces) a file; its folder must exist. */
    async write(name: string, p: string, data: Buffer): Promise<void> {
      const dir = path.posix.dirname(p)
      try { await deps.putArchive(name, dir, tarFile(path.posix.basename(p), data)) } catch (err) {
        if ((err as { statusCode?: number }).statusCode === 404) throw new Error(`No such folder: ${dir}`)
        throw err
      }
    },

    async mkdir(name: string, p: string): Promise<void> {
      const r = await deps.exec(name, ['mkdir', '-p', '--', p])
      if (r.code !== 0) throw new Error(r.stderr.trim() || `Could not make ${p}`)
    },

    async remove(name: string, p: string): Promise<void> {
      if (FILE_ROOTS.includes(p)) throw new Error(`${p} itself cannot be removed`)
      const r = await deps.exec(name, ['rm', '-rf', '--', p])
      if (r.code !== 0) throw new Error(r.stderr.trim() || `Could not remove ${p}`)
    },
  }
}

/** The sandboxes' files through the host's Docker (imported when used, so the helpers above stay testable alone). */
export const sandboxFiles = createSandboxFiles({
  exec: async (name, cmd) => (await import('./docker')).execRun(name, cmd),
  getArchive: async (name, p) => (await import('./docker')).archiveOf(name, p),
  putArchive: async (name, dir, tar) => (await import('./docker')).putArchiveTo(name, dir, tar),
})

const DEFAULT_MAX_UPLOAD = '100m'

/** FILES_MAX_UPLOAD: the largest file the Files tab takes (e.g. 100m, 1g); invalid → the default. */
export function filesMaxUpload(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.FILES_MAX_UPLOAD
  const v = raw ? parseMemory(raw) : null
  if (raw && v === null) console.warn(`[files] invalid FILES_MAX_UPLOAD "${raw}", using ${DEFAULT_MAX_UPLOAD}`)
  return v ?? parseMemory(DEFAULT_MAX_UPLOAD)!
}
