import { describe, it, expect, vi } from 'vitest'
import { Readable } from 'node:stream'
import { safePath, parseListing, createSandboxFiles, FILE_ROOTS } from '../../services/sandboxFiles'
import { tarFile, firstFile } from '../../services/tar'

const collect = async (s: AsyncIterable<Uint8Array>) => { const parts: Buffer[] = []; for await (const c of s) parts.push(Buffer.from(c)); return Buffer.concat(parts) }

describe('safePath', () => {
  it('only inside the folders that outlive a deep sleep', () => {
    expect(FILE_ROOTS).toEqual(['/root', '/home', '/srv', '/opt'])
    expect(safePath('/root')).toBe('/root')
    expect(safePath('/srv/app/../data/')).toBe('/srv/data')
    for (const bad of ['/etc', '/root/../etc', '/rootkit', 'root/x', '', '/']) expect(() => safePath(bad), bad).toThrow(/Only \/root, \/home, \/srv and \/opt/)
  })
})

describe('parseListing', () => {
  it('folders first, then files, by name; links and others say so; busybox and GNU stat both', () => {
    const out = ['regular file\t12\t1700000000\tb.txt', 'directory\t4096\t1700000100\tsrc', 'regular empty file\t0\t1700000200\ta.txt', 'symbolic link\t7\t1700000300\tlatest', 'directory\t4096\t1700000400\t.cache', 'fifo\t0\t1700000500\tpipe', ''].join('\n')
    expect(parseListing(out)).toEqual([
      { name: '.cache', type: 'dir', size: 4096, mtime: '2023-11-14T22:20:00.000Z' },
      { name: 'src', type: 'dir', size: 4096, mtime: '2023-11-14T22:15:00.000Z' },
      { name: 'a.txt', type: 'file', size: 0, mtime: '2023-11-14T22:16:40.000Z' },
      { name: 'b.txt', type: 'file', size: 12, mtime: '2023-11-14T22:13:20.000Z' },
      { name: 'latest', type: 'link', size: 7, mtime: '2023-11-14T22:18:20.000Z' },
      { name: 'pipe', type: 'other', size: 0, mtime: '2023-11-14T22:21:40.000Z' },
    ])
  })
  it('keeps a tab in a name', () => {
    expect(parseListing('regular file\t1\t1700000000\ta\tb')[0].name).toBe('a\tb')
  })
})

function fakes() {
  const exec = vi.fn(async (_name: string, cmd: string[]) => {
    const script = cmd[2], arg = cmd[4]
    // the listing script cds into the folder; the other one stats one path
    if (script.includes('cd --')) return arg === '/root/none' ? { code: 3, stdout: '', stderr: '' } : arg === '/root/a.txt' ? { code: 4, stdout: '', stderr: '' } : { code: 0, stdout: 'regular file\t5\t1700000000\ta.txt\n', stderr: '' }
    if (script.includes('stat ')) return arg === '/root/src' ? { code: 0, stdout: 'directory\t4096\n', stderr: '' } : arg === '/root/none' ? { code: 1, stdout: '', stderr: 'no such' } : { code: 0, stdout: `regular file\t${arg === '/root/big.log' ? 5_000_000 : 5}\n`, stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  })
  const files: Record<string, Buffer> = { '/root/a.txt': Buffer.from('hello'), '/root/bin.dat': Buffer.from([0, 1, 2, 3, 4]) }
  const getArchive = vi.fn(async (_name: string, path: string) => Readable.from([path === '/root/src' ? tarFile('src/', Buffer.alloc(0), { type: '5' }) : tarFile(path.split('/').pop()!, files[path] ?? Buffer.alloc(0))]))
  const putArchive = vi.fn(async (_name: string, _dir: string, _tar: Buffer) => {})
  return { exec, getArchive, putArchive, f: createSandboxFiles({ exec, getArchive, putArchive }) }
}

describe('sandbox files', () => {
  it('lists a folder, the path passed as an argument, never inside the script', async () => {
    const { exec, f } = fakes()
    expect(await f.list('p7y-a', '/root')).toEqual([{ name: 'a.txt', type: 'file', size: 5, mtime: '2023-11-14T22:13:20.000Z' }])
    const cmd = exec.mock.calls[0][1]
    expect(cmd.slice(0, 2)).toEqual(['sh', '-c'])
    expect(cmd[2]).not.toContain('/root')
    expect(cmd[4]).toBe('/root')
  })
  it('a missing folder, or a file, is an error that says so', async () => {
    const { f } = fakes()
    await expect(f.list('p7y-a', '/root/none')).rejects.toThrow('No such folder: /root/none')
    await expect(f.list('p7y-a', '/root/a.txt')).rejects.toThrow('Not a folder: /root/a.txt')
  })
  it('writes a file into its folder as a one-file tar', async () => {
    const { putArchive, f } = fakes()
    await f.write('p7y-a', '/root/notes/todo.md', Buffer.from('# todo'))
    const [name, dir, tar] = putArchive.mock.calls[0]
    expect([name, dir]).toEqual(['p7y-a', '/root/notes'])
    const file = await firstFile(Readable.from([tar]))
    expect(file?.name).toBe('todo.md')
    expect((await collect(file!.body)).toString()).toBe('# todo')
  })
  it('downloads a file as its bytes, a folder as a tar', async () => {
    const { f } = fakes()
    const file = await f.download('p7y-a', '/root/a.txt')
    expect(file.kind).toBe('file')
    expect((await collect(file.body)).toString()).toBe('hello')
    const dir = await f.download('p7y-a', '/root/src')
    expect(dir.kind).toBe('dir')
    expect((await collect(dir.body)).subarray(0, 4).toString()).toBe('src/')
  })
  it('reads a text file; a binary or big one is refused', async () => {
    const { f } = fakes()
    expect(await f.readText('p7y-a', '/root/a.txt')).toBe('hello')
    await expect(f.readText('p7y-a', '/root/bin.dat')).rejects.toThrow('Not a text file: /root/bin.dat')
    await expect(f.readText('p7y-a', '/root/big.log')).rejects.toThrow('Too big to read as text (over 1 MB): /root/big.log')
    await expect(f.readText('p7y-a', '/root/src')).rejects.toThrow('A folder: /root/src')
  })
  it('makes a folder and removes, never one of the four folders themselves', async () => {
    const { exec, f } = fakes()
    await f.mkdir('p7y-a', '/srv/data')
    expect(exec.mock.calls.at(-1)![1]).toEqual(['mkdir', '-p', '--', '/srv/data'])
    await f.remove('p7y-a', '/srv/data')
    expect(exec.mock.calls.at(-1)![1]).toEqual(['rm', '-rf', '--', '/srv/data'])
    await expect(f.remove('p7y-a', '/srv')).rejects.toThrow('/srv itself cannot be removed')
  })
})
