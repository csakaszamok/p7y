import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { writeFileAtomic } from '../atomicWrite'
import type { HubEntry } from './list'

/**
 * The Hub cards' images: the app's p7y.image (a path inside it), else its page's og:image (on its own host only).
 * Fetched in the background, straight from the sandbox container on the internal network (as appProbe does: it
 * neither wakes the sandbox nor keeps it awake), only from running apps; nothing outside the app is ever fetched.
 */

export interface Fetched { status: number; body: Buffer }
export interface ImageDeps {
  dir: string
  now: () => number
  /** GET a path from an app: the sandbox container, the app's port published in it */
  get: (sandbox: string, port: number, path: string, host: string) => Promise<Fetched>
}
interface Record_ { want: string; checked_at: number; ok: boolean; type?: string; version?: string }

const MAX_BYTES = 2 * 1024 * 1024
/** Larger images are refused: a small file can unpack to a huge one and stall the viewers' browsers (an image bomb) */
const MAX_SIDE = 4096
const TIMEOUT_MS = 5000
const RECHECK_MS = 24 * 3600_000
const RETRY_MS = 3600_000

const defaultDir = () => process.env.HUB_IMAGES_DIR ?? '/app/data/hub-images'

/** One GET, at most MAX_BYTES + 1 read, a deadline for the whole answer. */
export function httpGet(sandbox: string, port: number, p: string, host: string): Promise<Fetched> {
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    let size = 0
    const done = (f: Fetched) => { clearTimeout(timer); resolve(f); req.destroy() }
    const req = http.request({ host: sandbox, port, path: p, method: 'GET', headers: { Host: host, 'User-Agent': 'p7y-hub', Accept: 'text/html,image/*' } }, res => {
      res.on('data', (c: Buffer) => {
        size += c.length
        chunks.push(c)
        if (size > MAX_BYTES) done({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) })
      })
      res.on('end', () => done({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }))
    })
    const timer = setTimeout(() => done({ status: 0, body: Buffer.alloc(0) }), TIMEOUT_MS)
    req.on('error', () => done({ status: 0, body: Buffer.alloc(0) }))
    req.end()
  })
}

const defaults = (): ImageDeps => ({ dir: defaultDir(), now: Date.now, get: httpGet })

/** The og:image of a page, as a path on the app itself; null if there is none or it is on another host. */
export function ogImageOf(html: string, appHost: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    // Quoted or not (both are valid HTML; minifiers drop the quotes)
    if (!/\bproperty\s*=\s*(["']?)og:image\1(?=[\s/>])/i.test(tag)) continue
    const m = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag)
    const content = (m?.[1] ?? m?.[2] ?? m?.[3])?.trim()
    if (!content) continue
    let u: URL
    try { u = new URL(content, `https://${appHost}/`) } catch { continue }
    if (u.host.toLowerCase() !== appHost.toLowerCase()) return null
    return `${u.pathname}${u.search}`
  }
  return null
}

/** The image type by its first bytes (not by what the app claims); SVG and anything else: null. */
export function imageKind(b: Buffer): string | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.toString('latin1', 0, 6))) return 'image/gif'
  return null
}

/** An image's dimensions from its header (no decoding); null if they cannot be read. */
export function imageSize(b: Buffer): { width: number; height: number } | null {
  const kind = imageKind(b)
  try {
    if (kind === 'image/png') return b.toString('latin1', 12, 16) === 'IHDR' ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : null
    if (kind === 'image/gif') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
    if (kind === 'image/webp') {
      const chunk = b.toString('latin1', 12, 16)
      if (chunk === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 }
      if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
      if (chunk === 'VP8L') { const v = b.readUInt32LE(21); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 } }
      return null
    }
    if (kind === 'image/jpeg') {
      // Walk the segments to the frame header (SOF0–SOF15, not DHT/JPG/DAC)
      let i = 2
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null
        const marker = b[i + 1]
        if (marker === 0xff) { i++; continue }
        const len = b.readUInt16BE(i + 2)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) }
        }
        i += 2 + len
      }
      return null
    }
  } catch { return null }
  return null
}

const fileOf = (dir: string, id: string) => path.join(dir, crypto.createHash('sha1').update(id).digest('hex'))
const indexFile = (dir: string) => path.join(dir, 'index.json')

function readIndex(dir: string): Record<string, Record_> {
  try { return JSON.parse(fs.readFileSync(indexFile(dir), 'utf8')) as Record<string, Record_> } catch { return {} }
}

/** The stored image of an app, or null. version changes with its content (for the image URL). */
export function imageOf(id: string, deps: Partial<ImageDeps> = {}): { file: string; type: string; version: string } | null {
  const dir = deps.dir ?? defaultDir()
  const r = readIndex(dir)[id]
  const file = fileOf(dir, id)
  return r?.type && r.version && fs.existsSync(file) ? { file, type: r.type, version: r.version } : null
}

function due(r: Record_ | undefined, want: string, now: number): boolean {
  if (!r || r.want !== want) return true
  return now - r.checked_at >= (r.ok ? RECHECK_MS : RETRY_MS)
}

async function fetchImage(e: HubEntry, d: ImageDeps): Promise<{ type: string; body: Buffer } | null> {
  let p = e.image
  if (!p) {
    const pageRes = await d.get(e.sandbox, e.port, '/', e.id)
    if (pageRes.status !== 200) return null
    p = ogImageOf(pageRes.body.toString('utf8'), e.id)
    if (!p) return null
  }
  const res = await d.get(e.sandbox, e.port, p, e.id)
  if (res.status !== 200 || res.body.length > MAX_BYTES) return null
  const type = imageKind(res.body)
  const size = imageSize(res.body)
  if (!type || !size || !size.width || !size.height || size.width > MAX_SIDE || size.height > MAX_SIDE) return null
  return { type, body: res.body }
}

let running = false

/** Fetches the images that are due (one run at a time; a failure keeps the image an app had). */
export async function refreshImages(entries: HubEntry[], deps: Partial<ImageDeps> = {}): Promise<void> {
  const d = { ...defaults(), ...deps }
  if (running && !deps.get) return
  running = true
  try {
    fs.mkdirSync(d.dir, { recursive: true })
    const index = readIndex(d.dir)
    let changed = false
    for (const e of entries) {
      // Asleep or in deep sleep: asking would wake it; it keeps the image it had
      if (e.status !== 'running' || !e.port) continue
      const want = e.image ?? 'og:image'
      const now = d.now()
      if (!due(index[e.id], want, now)) continue
      const got = await fetchImage(e, d).catch(() => null)
      const prev = index[e.id]
      if (got) {
        writeFileAtomic(fileOf(d.dir, e.id), got.body)
        index[e.id] = { want, checked_at: now, ok: true, type: got.type, version: crypto.createHash('sha1').update(got.body).digest('hex').slice(0, 12) }
      } else if (prev && prev.want !== want) {
        // The label names another image now and it cannot be had: drop the old one (the card shows the letter)
        fs.rmSync(fileOf(d.dir, e.id), { force: true })
        index[e.id] = { want, checked_at: now, ok: false }
      } else {
        index[e.id] = { ...(prev ?? {}), want, checked_at: now, ok: false }
      }
      changed = true
    }
    if (changed) writeFileAtomic(indexFile(d.dir), JSON.stringify(index))
  } finally {
    running = false
  }
}
