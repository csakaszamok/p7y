import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.stubEnv('REGISTRY_SCANS_FILE', path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-scan-')), 'scans.json'))
const S = await import('../../services/registryScans')

describe('registryScans', () => {
  beforeEach(() => { try { fs.rmSync(process.env.REGISTRY_SCANS_FILE!) } catch { /* fresh */ } })

  it('a repo is clean for anonymous pull only when every version is', async () => {
    expect(S.repoIsClean('shop/todo')).toBe(false) // nothing known
    S.markPushed('shop/todo', 'sha256:a', '1')
    expect(S.repoIsClean('shop/todo')).toBe(false) // scanning
    await S.scanImage('shop/todo', 'sha256:a', { walk: async () => {} })
    expect(S.repoIsClean('shop/todo')).toBe(true)
    S.markPushed('shop/todo', 'sha256:b', '2')
    await S.scanImage('shop/todo', 'sha256:b', { walk: async (_r, _d, onFile) => { onFile({ path: 'app/.env', text: 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwx' }) } })
    const b = S.versionsOf('shop/todo').find(v => v.digest === 'sha256:b')!
    expect(b).toMatchObject({ state: 'flagged', tags: ['2'] })
    expect(b.findings.map(f => f.rule).sort()).toEqual(['env-file', 'openai-key'])
    expect(JSON.stringify(b.findings)).not.toContain('abcdefghijklmnopqrstuvwx') // never the whole value
    expect(S.repoIsClean('shop/todo')).toBe(false)
    S.forgetVersion('shop/todo', 'sha256:b')
    expect(S.repoIsClean('shop/todo')).toBe(true)
  })

  it('a file deleted in a later layer still counts', async () => {
    S.markPushed('shop/d', 'sha256:x', '1')
    await S.scanImage('shop/d', 'sha256:x', { walk: async (_r, _d, onFile) => { onFile({ path: 'app/.env', text: null, deleted: true }) } })
    expect(S.versionsOf('shop/d')[0]).toMatchObject({ state: 'flagged' })
  })

  it('a tag moved to a new digest leaves the old version', () => {
    S.markPushed('shop/m', 'sha256:1', 'latest')
    S.markPushed('shop/m', 'sha256:2', 'latest')
    expect(S.versionsOf('shop/m').map(v => [v.digest, v.tags])).toEqual([['sha256:1', []], ['sha256:2', ['latest']]])
  })

  it('an error keeps it private', async () => {
    S.markPushed('shop/x', 'sha256:c', '1')
    await S.scanImage('shop/x', 'sha256:c', { walk: async () => { throw new Error('blob unknown') } })
    expect(S.versionsOf('shop/x')[0]).toMatchObject({ state: 'error', error: 'blob unknown' })
    expect(S.repoIsClean('shop/x')).toBe(false)
  })

  it('lists a sandbox\'s repos', () => {
    S.markPushed('shop/a', 'sha256:d', '1'); S.markPushed('other/b', 'sha256:e', '1'); S.markPushed('shopping/c', 'sha256:f', '1')
    expect(S.reposOf('shop')).toEqual(['shop/a'])
  })
})

describe('review fixes: the gate', () => {
  beforeEach(() => { try { fs.rmSync(process.env.REGISTRY_SCANS_FILE!) } catch { /* fresh */ } })

  // A version the registry has but p7y never heard of (a lost notification, a push by digest) is not clean
  it('allows anonymous pull only when every tag in the registry points at a known, clean version', async () => {
    S.markPushed('shop/app', 'sha256:a', '1')
    await S.scanImage('shop/app', 'sha256:a', { walk: async () => {} })
    const deps = (tags: Record<string, string>) => ({ tags: async () => Object.keys(tags), digestOf: async (_r: string, t: string) => tags[t] })
    expect(await S.publicPullAllowed('shop/app', deps({ 1: 'sha256:a' }))).toBe(true)
    expect(await S.publicPullAllowed('shop/app', deps({ 1: 'sha256:a', 2: 'sha256:unknown' }))).toBe(false)
    expect(await S.publicPullAllowed('shop/none', deps({}))).toBe(false)
  })

  it('scans the image config (ENV, history) as well as the layers', async () => {
    S.markPushed('shop/env', 'sha256:e', '1')
    await S.scanImage('shop/env', 'sha256:e', { walk: async (_r, _d, onFile) => { onFile({ path: '(image config)', text: '{"config":{"Env":["OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwx"]}}' }) } })
    expect(S.versionsOf('shop/env')[0]).toMatchObject({ state: 'flagged', findings: [expect.objectContaining({ file: '(image config)', rule: 'openai-key' })] })
  })

  it('a scan that runs too long is stopped (its signal aborted), not left running', async () => {
    S.markPushed('shop/slow', 'sha256:s', '1')
    let aborted = false
    await S.scanImage('shop/slow', 'sha256:s', { timeoutMs: 50, walk: (_r, _d, _f, signal) => new Promise((_, rej) => signal.addEventListener('abort', () => { aborted = true; rej(new Error('aborted')) })) })
    expect(aborted).toBe(true)
    expect(S.versionsOf('shop/slow')[0]).toMatchObject({ state: 'error', error: 'scan took longer than 5 minutes' })
  })

  it('runs at most two scans at once', async () => {
    let running = 0, peak = 0
    const walk = async () => { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 30)); running-- }
    for (const d of ['1', '2', '3', '4']) S.markPushed('shop/q', `sha256:${d}`, d)
    await Promise.all(['1', '2', '3', '4'].map(d => S.enqueueScan('shop/q', `sha256:${d}`, { walk })))
    expect(peak).toBe(2)
    expect(S.versionsOf('shop/q').every(v => v.state === 'clean')).toBe(true)
  })

  it('resumes scans that were running when p7y stopped', async () => {
    S.markPushed('shop/r', 'sha256:r', '1') // left "scanning"
    await S.resumeScans({ walk: async () => {} })
    expect(S.versionsOf('shop/r')[0].state).toBe('clean')
  })

  it('a re-push of a version already scanned only adds the tag', async () => {
    S.markPushed('shop/t', 'sha256:t', '1')
    await S.scanImage('shop/t', 'sha256:t', { walk: async () => {} })
    expect(S.markPushed('shop/t', 'sha256:t', 'latest')).toBe(false) // no new scan needed
    expect(S.versionsOf('shop/t')[0]).toMatchObject({ state: 'clean', tags: ['1', 'latest'] })
  })

  it('reads the registry: config blob and layers, nothing buffered, and an image with no layers is an error', async () => {
    const zlib = await import('zlib')
    const tarOf = (name: string, body: string) => {
      const h = Buffer.alloc(512); h.write(name, 0); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116)
      h.write(Buffer.byteLength(body).toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263)
      h.fill(' ', 148, 156); let sum = 0; for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
      const b = Buffer.from(body); return zlib.gzipSync(Buffer.concat([h, b, Buffer.alloc((512 - (b.length % 512)) % 512), Buffer.alloc(1024)]))
    }
    const blobs: Record<string, Buffer | string> = {
      'manifests/sha256:m': JSON.stringify({ mediaType: 'application/vnd.oci.image.manifest.v1+json', config: { digest: 'sha256:cfg' }, layers: [{ digest: 'sha256:l1', size: 10 }] }),
      'blobs/sha256:cfg': JSON.stringify({ config: { Env: ['PATH=/bin'] } }),
      'blobs/sha256:l1': tarOf('usr/lib/python3/site-packages/certifi/cacert.pem', '-----BEGIN CERTIFICATE-----\nMIIB\n'),
      'manifests/sha256:empty': JSON.stringify({ mediaType: 'application/vnd.oci.image.manifest.v1+json', config: { digest: 'sha256:cfg' } }),
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const key = String(url).replace(/^.*\/v2\/[^/]+\/[^/]+\//, '')
      const b = blobs[key]
      return b === undefined ? new Response('no', { status: 404 }) : new Response(typeof b === 'string' ? b : new Uint8Array(b))
    }))
    S.markPushed('shop/real', 'sha256:m', '1')
    await S.scanImage('shop/real', 'sha256:m')
    expect(S.versionsOf('shop/real')[0].state).toBe('clean') // a CA bundle is not a secret
    S.markPushed('shop/real', 'sha256:empty', '2')
    await S.scanImage('shop/real', 'sha256:empty')
    expect(S.versionsOf('shop/real').find(v => v.digest === 'sha256:empty')!.state).toBe('error')
    vi.unstubAllGlobals()
  })
})

describe('review fixes: BuildKit indexes (found live)', () => {
  beforeEach(() => { try { fs.rmSync(process.env.REGISTRY_SCANS_FILE!) } catch { /* fresh */ } })
  it('reads non-tar layers (attestations) as text, and an index covers its untagged platform manifests', async () => {
    const zlib = await import('zlib')
    const tarOf = (name: string, body: string) => {
      const h = Buffer.alloc(512); h.write(name, 0); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116)
      h.write(Buffer.byteLength(body).toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263)
      h.fill(' ', 148, 156); let sum = 0; for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
      const b = Buffer.from(body); return Buffer.concat([h, b, Buffer.alloc((512 - (b.length % 512)) % 512), Buffer.alloc(1024)])
    }
    const blobs: Record<string, Buffer | string> = {
      'manifests/sha256:idx': JSON.stringify({ mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [
        { digest: 'sha256:img' }, { digest: 'sha256:att', annotations: { 'vnd.docker.reference.type': 'attestation-manifest' } }] }),
      'manifests/sha256:img': JSON.stringify({ config: { digest: 'sha256:cfg' }, layers: [
        { digest: 'sha256:gz', size: 1, mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip' },
        { digest: 'sha256:plain', size: 1, mediaType: 'application/vnd.oci.image.layer.v1.tar' }] }),
      'manifests/sha256:att': JSON.stringify({ config: { digest: 'sha256:cfg' }, layers: [{ digest: 'sha256:intoto', size: 1, mediaType: 'application/vnd.in-toto+json' }] }),
      'blobs/sha256:cfg': '{}',
      'blobs/sha256:gz': zlib.gzipSync(tarOf('app/index.js', 'ok')),
      'blobs/sha256:plain': tarOf('app/other.js', 'ok'),
      'blobs/sha256:intoto': JSON.stringify({ predicate: { buildArgs: { TOKEN: 'ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ' } } }),
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const b = blobs[String(url).replace(/^.*\/v2\/[^/]+\/[^/]+\//, '')]
      return b === undefined ? new Response('no', { status: 404 }) : new Response(typeof b === 'string' ? b : new Uint8Array(b))
    }))
    // BuildKit pushes the platform and attestation manifests (untagged) before the tagged index
    S.markPushed('shop/bk', 'sha256:img'); S.markPushed('shop/bk', 'sha256:att'); S.markPushed('shop/bk', 'sha256:idx', '1')
    await S.scanImage('shop/bk', 'sha256:idx')
    expect(S.versionsOf('shop/bk').map(v => [v.digest, v.state])).toEqual([['sha256:idx', 'flagged']]) // the children are covered
    expect(S.versionsOf('shop/bk')[0].findings.map(f => f.rule)).toEqual(['github-token']) // found in the attestation
    vi.unstubAllGlobals()
  })
})
