import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { voteCounts, votedBy, addVote, removeVote } from '../../../services/hub/votes'

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hubvotes-')), 'votes.json')

describe('votes', () => {
  it('one vote per user per app, and it can be taken back', () => {
    const f = file()
    addVote('a.example.com', 'peter@example.com', f)
    addVote('a.example.com', 'peter@example.com', f)
    addVote('a.example.com', 'eva@example.com', f)
    expect(voteCounts(f)).toEqual({ 'a.example.com': 2 })
    expect([...votedBy('peter@example.com', f)]).toEqual(['a.example.com'])
    removeVote('a.example.com', 'peter@example.com', f)
    removeVote('a.example.com', 'nobody@example.com', f)
    expect(voteCounts(f)).toEqual({ 'a.example.com': 1 })
  })
  it('starts empty without a file', () => {
    expect(voteCounts(file())).toEqual({})
  })
})
