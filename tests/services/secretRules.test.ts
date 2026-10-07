import { describe, it, expect } from 'vitest'
import { checkName, checkContent, mask, isText } from '../../services/secretRules'

describe('file names', () => {
  it('flags env files, keys and credential files; not the samples or public keys', () => {
    for (const f of ['app/.env', '.env.local', 'srv/.env.production', 'a.p12', 'b.pfx', 'home/u/.ssh/id_rsa', 'id_ed25519', 'credentials.json', '.git-credentials', 'p7y.env', 'root/.docker/config.json'])
      expect(checkName(f), f).not.toBeNull()
    for (const f of ['.env.example', 'app/.env.sample', '.env.template', 'src/env.ts', 'README.md', 'package.json', 'home/u/.ssh/id_ed25519.pub', 'environment.yml', 'pip/_vendor/certifi/cacert.pem', 'certs/server.pem', 'x.key'])
      expect(checkName(f), f).toBeNull()
  })
})

describe('contents', () => {
  // Fake keys, split so secret scanners (GitHub push protection) do not take this file for a leak
  const cases: Array<[string, string]> = [
    ['private-key', '-----BEGIN OPENSSH PRIVATE KEY-----\nabc'],
    ['aws-access-key', 'key=AKIA' + 'ABCDEFGHIJKLMNOP'],
    ['anthropic-key', 'ANTHROPIC_API_KEY=sk-ant-' + 'api03-abcdefghijklmnopqrstuvwxyz012345'],
    ['openai-key', 'const k = "sk-' + 'proj-abcdefghijklmnopqrstuvwx"'],
    ['github-token', 'ghp_' + 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ'],
    ['slack-token', 'xoxb-' + '1234567890-abcdefghij'],
    ['stripe-live-key', 'sk_live_' + 'abcdefghijklmnopqrstuvwx'],
    ['google-api-key', 'AIza' + 'SyA1234567890abcdefghijklmnopqrstuv'],
    ['p7y-token', 'P7Y_TOKEN=p7y_abcdefghijklmnopqrstuvwxyz'],
  ]
  it.each(cases)('finds %s', (rule, text) => {
    expect(checkContent('src/x.js', text).map(f => f.rule)).toContain(rule)
  })
  it('an Anthropic key is not also reported as an OpenAI key', () => {
    expect(checkContent('a', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345').map(f => f.rule)).toEqual(['anthropic-key'])
  })
  it('flags .npmrc only with a token', () => {
    expect(checkContent('.npmrc', 'registry=https://registry.npmjs.org/')).toEqual([])
    expect(checkContent('.npmrc', '//registry.npmjs.org/:_authToken=abc123').map(f => f.rule)).toEqual(['npmrc-token'])
  })
  it('a sample value is not a secret; masks keep 4 + 3 characters', () => {
    expect(checkContent('a.js', 'sk-...')).toEqual([])
    expect(mask('sk-proj-abcdefghijklmnopqrstuvwx')).toBe('sk-p…vwx')
    expect(checkContent('a.js', 'ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ')[0].sample).toBe('ghp_…HIJ')
  })
  it('tells text from binary', () => {
    expect(isText(Buffer.from('hello\nworld'))).toBe(true)
    expect(isText(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 1, 2]))).toBe(false)
  })
})

describe('review fixes: PEM files', () => {
  // A CA bundle (python's certifi, rubygems) is in countless base images: only a private key is a secret
  it('a private key in a .pem / .key file is found by its content, a certificate is not', () => {
    expect(checkContent('certs/server.key', '-----BEGIN RSA PRIVATE KEY-----\nMIIE').map(f => f.rule)).toEqual(['private-key'])
    expect(checkContent('pip/_vendor/certifi/cacert.pem', '-----BEGIN CERTIFICATE-----\nMIIB')).toEqual([])
  })
})
