/** A secret-looking thing found in an image: the file, the rule, and a masked sample (never the whole value). */
export interface Finding { file: string; rule: string; sample: string }

const NAME_RULES: Array<[string, RegExp]> = [
  // .env, .env.local, .env.production… but not the samples projects ship on purpose
  ['env-file', /(^|\/)\.env(\.(?!(example|sample|template)$)[^/]+)?$/],
  // .pem / .key: only a private key is a secret (the content rule finds it); CA bundles are in many base images
  ['key-store', /\.(p12|pfx)$/],
  ['ssh-key', /(^|\/)id_(rsa|ed25519|ecdsa|dsa)(?!\.pub$)[^/]*$/],
  ['credentials-file', /(^|\/)(credentials\.json|\.git-credentials|p7y\.env)$/],
  ['docker-config', /(^|\/)\.docker\/config\.json$/],
]

// Ordered: the Anthropic rule before the OpenAI one, which excludes it
const CONTENT_RULES: Array<[string, RegExp]> = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['openai-key', /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}/],
  ['github-token', /\b(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,})/],
  ['slack-token', /\bxox[bpas]-[A-Za-z0-9-]{10,}/],
  ['stripe-live-key', /\bsk_live_[A-Za-z0-9]{20,}/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}/],
  ['p7y-token', /\bp7y_[A-Za-z0-9_-]{20,}/],
]

/** First 4 and last 3 characters: enough to recognise the key, not enough to use it. */
export const mask = (v: string) => (v.length <= 8 ? '…' : `${v.slice(0, 4)}…${v.slice(-3)}`)

/** The rule a file name breaks, or null. */
export function checkName(path: string): string | null {
  for (const [rule, re] of NAME_RULES) if (re.test(path)) return rule
  return null
}

/** Secret-looking values in a text file. .npmrc / .pypirc count only with a token or password line. */
export function checkContent(path: string, text: string): Finding[] {
  if (/(^|\/)\.(npmrc|pypirc)$/.test(path)) {
    const m = /(_authToken|_auth|password)\s*=\s*(\S+)/.exec(text)
    return m ? [{ file: path, rule: `${path.endsWith('npmrc') ? 'npmrc' : 'pypirc'}-token`, sample: mask(m[2]) }] : []
  }
  const out: Finding[] = []
  for (const [rule, re] of CONTENT_RULES) {
    const m = re.exec(text)
    if (m) out.push({ file: path, rule, sample: mask(m[0]) })
  }
  return out
}

/** Text unless there is a NUL byte in its first 8 KB. */
export const isText = (buf: Buffer) => !buf.subarray(0, 8192).includes(0)
