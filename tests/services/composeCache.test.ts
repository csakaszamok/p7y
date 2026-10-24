import { describe, it, expect } from 'vitest'
import { parseComposeText } from '../../services/composeCache'

describe('parseComposeText', () => {
  it('parses an unchanged text once, a changed one afresh', () => {
    const text = 'services:\n  sandbox:\n    mem_limit: 1g\n'
    const first = parseComposeText(text)
    expect(first).toEqual({ services: { sandbox: { mem_limit: '1g' } } })
    expect(parseComposeText(`${text}`)).toBe(first)
    expect(parseComposeText(text.replace('1g', '2g'))).toEqual({ services: { sandbox: { mem_limit: '2g' } } })
  })
})
