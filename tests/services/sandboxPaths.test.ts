import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ownerDirName, ownerOfCompose, listSandboxDirs, entriesIn, sandboxDir, sandboxParent, newSandboxDir, archiveRoot, forgetSandboxDir } from '../../services/sandboxPaths'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-sp-')).replace(/\\/g, '/')
const put = (dir: string, owner?: string) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(`${dir}/docker-compose.yml`, owner ? `services:\n  sandbox:\n    labels:\n      p7y.owner: ${owner}\n` : 'services: {}\n')
}

beforeEach(() => {
  process.env.SANDBOXES_DIR = tmp(); process.env.LEGACY_USERS_DIR = tmp(); process.env.ARCHIVE_DIR = tmp()
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
  it('reads the owner label (p7y or leander), admin without one', () => {
    expect(ownerOfCompose('      p7y.owner: "a@b.c"\n')).toBe('a@b.c')
    expect(ownerOfCompose('      leander.owner: bob\n')).toBe('bob')
    expect(ownerOfCompose('services: {}')).toBe('admin')
  })
})

describe('listSandboxDirs / sandboxDir', () => {
  it('lists both layouts; a name in both counts once, from the new layout', () => {
    put(`${process.env.SANDBOXES_DIR}/a@b.c/p7y-new`, 'a@b.c')
    put(`${process.env.LEGACY_USERS_DIR}/p7y-old`, 'admin')
    put(`${process.env.LEGACY_USERS_DIR}/p7y-new`, 'a@b.c')
    const list = listSandboxDirs().sort((x, y) => x.name.localeCompare(y.name))
    expect(list).toEqual([
      { name: 'p7y-new', owner: 'a@b.c', dir: `${process.env.SANDBOXES_DIR}/a@b.c/p7y-new`, legacy: false },
      { name: 'p7y-old', owner: 'admin', dir: `${process.env.LEGACY_USERS_DIR}/p7y-old`, legacy: true },
    ])
    expect(sandboxDir('p7y-old')).toBe(`${process.env.LEGACY_USERS_DIR}/p7y-old`)
    expect(sandboxDir('p7y-new')).toBe(`${process.env.SANDBOXES_DIR}/a@b.c/p7y-new`)
    expect(sandboxDir('p7y-none')).toBeNull()
    expect(sandboxDir('../etc')).toBeNull()
  })
  it('notices a move after a cached lookup', () => {
    put(`${process.env.LEGACY_USERS_DIR}/p7y-x`, 'admin')
    expect(sandboxDir('p7y-x')).toBe(`${process.env.LEGACY_USERS_DIR}/p7y-x`)
    put(`${process.env.SANDBOXES_DIR}/admin/p7y-x`, 'admin')
    fs.rmSync(`${process.env.LEGACY_USERS_DIR}/p7y-x`, { recursive: true })
    expect(sandboxDir('p7y-x')).toBe(`${process.env.SANDBOXES_DIR}/admin/p7y-x`)
  })
  it('sandboxParent, newSandboxDir, archiveRoot', () => {
    put(`${process.env.SANDBOXES_DIR}/admin/p7y-y`, 'admin')
    expect(sandboxParent('p7y-y')).toBe(`${process.env.SANDBOXES_DIR}/admin`)
    expect(sandboxParent('p7y-none')).toBe(process.env.LEGACY_USERS_DIR)
    expect(newSandboxDir('Bob', 'p7y-z')).toBe(`${process.env.SANDBOXES_DIR}/bob/p7y-z`)
    expect(archiveRoot('a@b.c')).toBe(`${process.env.ARCHIVE_DIR}/a@b.c`)
  })
})

describe('entriesIn', () => {
  it('without a directory: every sandbox; with one: that flat directory (tests, old callers)', () => {
    put(`${process.env.SANDBOXES_DIR}/admin/p7y-a`, 'admin')
    const flat = tmp()
    put(`${flat}/p7y-f`, 'bob')
    fs.writeFileSync(`${flat}/stray-file`, '')
    expect(entriesIn().map(e => e.name)).toEqual(['p7y-a'])
    expect(entriesIn(flat)).toEqual([{ name: 'p7y-f', owner: 'bob', dir: `${flat}/p7y-f`, legacy: true }])
    expect(entriesIn('/nonexistent')).toEqual([])
  })
})

describe('review fixes', () => {
  it("reads an owner label with an apostrophe or quotes (JSON-quoted as written at create)", () => {
    expect(ownerOfCompose(`      p7y.owner: ${JSON.stringify("o'brien@x.com")}\n`)).toBe("o'brien@x.com")
    expect(ownerOfCompose(`      p7y.owner: ${JSON.stringify('a"b@x')}\n`)).toBe('a"b@x')
    expect(ownerOfCompose("      p7y.owner: 'it''s@x'\n")).toBe("it's@x")
  })
  it('a legacy directory without a compose file is not a sandbox (it does not block its name)', () => {
    fs.mkdirSync(`${process.env.LEGACY_USERS_DIR}/p7y-left`, { recursive: true })
    expect(listSandboxDirs()).toEqual([])
    expect(sandboxDir('p7y-left')).toBeNull()
  })
})
