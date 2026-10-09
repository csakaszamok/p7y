import { describe, it, expect, vi } from 'vitest'
import { waitForTunnels } from '../../services/tunnelWait'

// Answers in turn (the last one repeats); counts the rounds slept
const frps = (...answers: string[][]) => {
  let i = 0
  return { poll: vi.fn(async () => answers[Math.min(i++, answers.length - 1)]), sleep: vi.fn(async () => {}) }
}

describe('waitForTunnels', () => {
  it('done as soon as every expected app is served, whatever the case', async () => {
    const f = frps([], ['a-web.lvh.me'], ['A-Web.lvh.me', 'a-portainer.lvh.me'])
    expect(await waitForTunnels(f.poll, ['a-web.lvh.me', 'a-portainer.lvh.me'], { sleep: f.sleep })).toEqual(['A-Web.lvh.me', 'a-portainer.lvh.me'])
    expect(f.poll).toHaveBeenCalledTimes(3)
  })

  it('an app named otherwise than expected: the answer once it held for 2 s', async () => {
    const f = frps(['a-x.lvh.me'])
    expect(await waitForTunnels(f.poll, ['a-web.lvh.me'], { sleep: f.sleep })).toEqual(['a-x.lvh.me'])
    expect(f.poll).toHaveBeenCalledTimes(5) // seen, then 4 × 500 ms unchanged
  })

  it('a failed poll keeps what was seen', async () => {
    const f = frps(['a-web.lvh.me'], [])
    expect(await waitForTunnels(f.poll, ['a-web.lvh.me', 'a-db.lvh.me'], { sleep: f.sleep })).toEqual(['a-web.lvh.me'])
  })

  it('nothing ever: gives up after 30 s', async () => {
    const f = frps([])
    expect(await waitForTunnels(f.poll, ['a-web.lvh.me'], { sleep: f.sleep })).toEqual([])
    expect(f.poll).toHaveBeenCalledTimes(60)
  })

  it('no app published: does not wait at all', async () => {
    const f = frps(['a-web.lvh.me'])
    expect(await waitForTunnels(f.poll, [], { sleep: f.sleep })).toEqual([])
    expect(f.poll).not.toHaveBeenCalled()
  })
})
