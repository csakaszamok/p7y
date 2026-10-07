import fs from 'fs'
import path from 'path'

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES'])

/**
 * Writes a file whole or not at all: a temp file next to it, then a rename. On Windows a virus scanner can hold
 * the fresh temp file for a moment and the rename fails with EPERM: it is retried a few times before giving up.
 */
export function writeFileAtomic(file: string, data: string, deps: { rename?: (from: string, to: string) => void } = {}): void {
  const rename = deps.rename ?? fs.renameSync
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, data)
  for (let attempt = 0; ; attempt++) {
    try { rename(tmp, file); return } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? ''
      if (attempt >= 5 || !TRANSIENT.has(code)) { try { fs.rmSync(tmp, { force: true }) } catch { /* gone */ } throw err }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1)) // a short, synchronous pause
    }
  }
}
