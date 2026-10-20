#!/usr/bin/env node
// p7y-local: the Claude Code plugin's helper on the user's machine (an MCP server over stdio, Node 18+, no packages).
// One tool, setup_project_dir: it fetches a sandbox's Docker client keys from Purgatory and writes them into the
// project's .p7y folder itself, checks them, and sets up the docker context. The keys never pass through the model:
// copied by hand they get garbled, and in an answer they end up in its context and transcript.
//
// P7Y_URL and P7Y_TOKEN: the plugin's settings. P7Y_DOCKER: the docker command (default "docker").
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const VERSION = '1'
const URL_ = (process.env.P7Y_URL ?? '').replace(/\/+$/, '')
const TOKEN = process.env.P7Y_TOKEN ?? ''
const DOCKER = process.env.P7Y_DOCKER || 'docker'

const TOOL = {
  name: 'setup_project_dir',
  description: "Sets up a project's .p7y folder for a sandbox: fetches its Docker client keys from Purgatory and writes them to disk itself (never through you), with p7y.env and a .gitignore; checks the key matches the certificate and the CA signed it; adds .p7y to .dockerignore; and creates the docker context again (removed first: a context keeps copies of the files). Answers with the files, the certificate's fingerprint and the context name; never the key. Run it again after new keys, or after any TLS error (do not repair a key file).",
  inputSchema: {
    type: 'object',
    properties: {
      sandbox: { type: 'string', description: "The sandbox's full name (p7y-shop); default: P7Y_SANDBOX in the project's .p7y/p7y.env, or the one sandbox a limited token is for" },
      project_dir: { type: 'string', description: "The project's root folder (absolute); default: the current folder" },
    },
  },
}

async function api(p) {
  if (!URL_ || !TOKEN) throw new Error('the plugin is not configured: /plugin → p7y → configure (address and token)')
  const res = await fetch(`${URL_}${p}`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${p}: ${res.status} ${body.error ?? ''}`.trim())
  return body
}

const envValue = (file, key) => {
  try { return new RegExp(`^${key}=(.*)$`, 'm').exec(fs.readFileSync(file, 'utf8'))?.[1]?.trim() || null } catch { return null }
}

/** The key, the certificate and the CA belong together; throws why not */
function check(ca, cert, key) {
  let k, c, a
  try { k = crypto.createPrivateKey(key) } catch { throw new Error('the private key cannot be read') }
  try { c = new crypto.X509Certificate(cert); a = new crypto.X509Certificate(ca) } catch { throw new Error('a certificate cannot be read') }
  if (!c.checkPrivateKey(k)) throw new Error('the private key does not match the certificate')
  if (!c.verify(a.publicKey)) throw new Error('the certificate is not signed by the CA')
  return c.fingerprint256
}

function dockerContext(name, host, dir) {
  const files = ['ca', 'cert', 'key'].map(f => path.join(dir, `${f}.pem`))
  const spec = `host=${host},ca=${files[0]},cert=${files[1]},key=${files[2]}`
  const run = args => execFileSync(DOCKER, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(DOCKER) })
  try { run(['context', 'rm', '-f', name]) } catch (err) {
    if (err.code === 'ENOENT') return { context: null, docker: `docker not found (${DOCKER}): install the docker command line, then run this again` }
  }
  try { run(['context', 'create', name, '--docker', spec]) } catch (err) {
    if (err.code === 'ENOENT') return { context: null, docker: `docker not found (${DOCKER}): install the docker command line, then run this again` }
    return { context: null, docker: `docker context create failed: ${String(err.stderr || err.message).trim().slice(0, 300)}` }
  }
  return { context: name, docker: `context ${name} ready: check it with docker --context ${name} compose ls (the sandbox must be running)` }
}

async function setupProjectDir(args) {
  const project = path.resolve(args.project_dir || process.cwd())
  const p7y = path.join(project, '.p7y')
  const me = await api('/me')
  const name = args.sandbox || envValue(path.join(p7y, 'p7y.env'), 'P7Y_SANDBOX') || me.sandbox
  if (!name) throw new Error('which sandbox? Give sandbox (its full name, e.g. p7y-shop): this token reaches more than one')
  const s = await api(`/sandboxes/${encodeURIComponent(name)}?include_keys=true`)
  if (s.docker_access?.state !== 'ready') throw new Error(`Docker access is not on for ${name} (${s.docker_access?.state ?? 'unknown'}): the owner turns it on in Purgatory (the sandbox → Access → Enable; it restarts the sandbox)`)
  if (!s.ca_cert || !s.client_cert || !s.client_key) throw new Error(`Purgatory gave no keys for ${name}`)
  // Checked before anything is written
  const fingerprint = check(s.ca_cert, s.client_cert, s.client_key)
  const docker = path.join(p7y, 'docker')
  fs.mkdirSync(docker, { recursive: true })
  fs.writeFileSync(path.join(p7y, '.gitignore'), '*\n')
  fs.writeFileSync(path.join(docker, 'ca.pem'), s.ca_cert)
  fs.writeFileSync(path.join(docker, 'cert.pem'), s.client_cert)
  fs.writeFileSync(path.join(docker, 'key.pem'), s.client_key, { mode: 0o600 })
  const host = `tcp://${s.docker_access.host}:443`
  fs.writeFileSync(path.join(p7y, 'p7y.env'), `P7Y_URL=${me.url || URL_}\nP7Y_SANDBOX=${name}\nP7Y_DOCKER_HOST=${host}\n`)
  const dockerignore = path.join(project, '.dockerignore')
  const ignored = fs.existsSync(dockerignore) ? fs.readFileSync(dockerignore, 'utf8') : ''
  if (!/^\.p7y\/?$/m.test(ignored)) fs.writeFileSync(dockerignore, `${ignored}${ignored && !ignored.endsWith('\n') ? '\n' : ''}.p7y\n`)
  const raw = name.replace(/^[a-z0-9]+-/, '')
  const ctx = dockerContext(`p7y-${raw}`, host, docker)
  return {
    ok: true, sandbox: name, status: s.status,
    files: ['.p7y/.gitignore', '.p7y/p7y.env', '.p7y/docker/ca.pem', '.p7y/docker/cert.pem', '.p7y/docker/key.pem', '.dockerignore'],
    keys: 'valid: the key matches the certificate, the CA signed it', fingerprint,
    ...ctx,
    ...(s.status !== 'running' ? { note: `${name} is ${s.status}: wake it (wake_sandbox) before using docker` } : {}),
  }
}

// MCP over stdio: one JSON-RPC message per line
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
const fail = (id, code, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')

async function handle(msg) {
  const { id, method, params } = msg
  if (id === undefined) return // a notification
  if (method === 'initialize') return reply(id, { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'p7y-local', version: VERSION } })
  if (method === 'ping') return reply(id, {})
  if (method === 'tools/list') return reply(id, { tools: [TOOL] })
  if (method === 'tools/call') {
    if (params?.name !== TOOL.name) return fail(id, -32602, `unknown tool: ${params?.name}`)
    try {
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(await setupProjectDir(params.arguments ?? {}), null, 2) }] })
    } catch (err) {
      return reply(id, { content: [{ type: 'text', text: `setup_project_dir failed: ${err.message}` }], isError: true })
    }
  }
  return fail(id, -32601, `method not found: ${method}`)
}

let buf = ''
process.stdin.on('data', d => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { fail(null, -32700, 'parse error'); continue }
    handle(msg).catch(err => fail(msg.id ?? null, -32603, err.message))
  }
})
