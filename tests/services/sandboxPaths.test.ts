import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ownerDirName, ownerOfCompose, listSandboxDirs, entriesIn, sandboxDir, sandboxParent, newSandboxDir, archiveRoot, forgetSandboxDir } from '../../services/sandboxPaths'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p9m-sp-')).replace(/\\/g, '/')
const put = (dir: string, owner?: string) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(`${dir}/docker-compose.yml`, owner ? `services:\n  sandbox:\n    labels:\n      p9m.owner: ${owner}\n` : 'services: {}\n')
}

// Where sandboxes sat before opt/sandboxes/<owner>/<name> (opt/users): not looked at any more
let OLD_USERS = ''

beforeEach(() => {
  process.env.SANDBOXES_DIR = tmp(); process.env.ARCHIVE_DIR = tmp(); OLD_USERS = tmp()
  forgetSandboxDir()
})

describe('ownerDirName', () => {
  it('keeps an e-mail, lower-cases, replaces anything unsafe', () => {
    expect(ownerDirName('admin')).toBe('admin')
    expect(ownerDirName('Jane.Doe@Example.com')).toBe('jane.doe@example.com')
    expect(ownerDirName('a/b c')).toBe('a_b_c')
    for (const bad of ['', '.', '..']) expect(ownerDirName(bad)).toBe('_')
  })
})

describe('ownerOfCompose', () => {
  it('reads the p9m.owner label only, admin without one', () => {
    expect(ownerOfCompose('      p9m.owner: "a@b.c"\n')).toBe('a@b.c')
    expect(ownerOfCompose('      p9m.owner: bob\n')).toBe('bob')
    expect(ownerOfCompose('      leander.owner: bob\n')).toBe('admin')
    expect(ownerOfCompose('services: {}')).toBe('admin')
  })
})

describe('listSandboxDirs / sandboxDir', () => {
  it('lists the per-owner layout only', () => {
    put(`${process.env.SANDBOXES_DIR}/a@b.c/p9m-new`, 'a@b.c')
    put(`${OLD_USERS}/p9m-old`, 'admin')
    expect(listSandboxDirs()).toEqual([{ name: 'p9m-new', owner: 'a@b.c', dir: `${process.env.SANDBOXES_DIR}/a@b.c/p9m-new` }])
    expect(sandboxDir('p9m-new')).toBe(`${process.env.SANDBOXES_DIR}/a@b.c/p9m-new`)
    expect(sandboxDir('p9m-old')).toBeNull()
    expect(sandboxDir('p9m-none')).toBeNull()
    expect(sandboxDir('../etc')).toBeNull()
  })
  it('sandboxParent, newSandboxDir, archiveRoot', () => {
    put(`${process.env.SANDBOXES_DIR}/admin/p9m-y`, 'admin')
    expect(sandboxParent('p9m-y')).toBe(`${process.env.SANDBOXES_DIR}/admin`)
    expect(sandboxParent('p9m-none')).toBe(process.env.SANDBOXES_DIR)
    expect(newSandboxDir('Bob', 'p9m-z')).toBe(`${process.env.SANDBOXES_DIR}/bob/p9m-z`)
    expect(archiveRoot('a@b.c')).toBe(`${process.env.ARCHIVE_DIR}/a@b.c`)
  })
})

describe('entriesIn', () => {
  it('without a directory: every sandbox; with one: the sandboxes in that directory (tests)', () => {
    put(`${process.env.SANDBOXES_DIR}/admin/p9m-a`, 'admin')
    const flat = tmp()
    put(`${flat}/p9m-f`, 'bob')
    fs.writeFileSync(`${flat}/stray-file`, '')
    expect(entriesIn().map(e => e.name)).toEqual(['p9m-a'])
    expect(entriesIn(flat)).toEqual([{ name: 'p9m-f', owner: 'bob', dir: `${flat}/p9m-f` }])
    expect(entriesIn('/nonexistent')).toEqual([])
  })
})

describe('review fixes', () => {
  it("reads an owner label with an apostrophe or quotes (JSON-quoted as written at create)", () => {
    expect(ownerOfCompose(`      p9m.owner: ${JSON.stringify("o'brien@x.com")}\n`)).toBe("o'brien@x.com")
    expect(ownerOfCompose(`      p9m.owner: ${JSON.stringify('a"b@x')}\n`)).toBe('a"b@x')
    expect(ownerOfCompose("      p9m.owner: 'it''s@x'\n")).toBe("it's@x")
  })
})
