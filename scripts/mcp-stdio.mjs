#!/usr/bin/env node
// Purgatory's MCP server over stdio, for clients (and checkers) that only start a local process.
// Reads JSON-RPC messages from stdin, one per line, POSTs each to a Purgatory /mcp (Streamable HTTP)
// and writes the answers to stdout, one per line. Notifications get no answer. No dependencies.
//
//   P7Y_URL=http://127.0.0.1:3000 P7Y_TOKEN=p7y_… node scripts/mcp-stdio.mjs
//
// stdout is the protocol channel: anything else goes to stderr.
import { createInterface } from 'node:readline'

const base = (process.env.P7Y_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '')
const token = process.env.P7Y_TOKEN ?? process.env.ADMIN_TOKEN ?? ''
const out = line => process.stdout.write(line + '\n')

/** The JSON-RPC answers in a response body: plain JSON, or the `data:` lines of an event stream. */
function answers(contentType, body) {
  if (!contentType.includes('text/event-stream')) return body.trim() ? [body.trim()] : []
  return body.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).filter(Boolean)
}

async function forward(line) {
  let id = null
  try { id = JSON.parse(line).id ?? null } catch { /* sent on as it is; the server answers the parse error */ }
  try {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: line,
    })
    const body = await res.text()
    let parsed = null
    try { parsed = JSON.parse(body) } catch { /* an event stream, or not JSON */ }
    if (!res.ok && parsed?.jsonrpc === undefined && !res.headers.get('content-type')?.includes('text/event-stream')) {
      // An HTTP error (401 without a token, 5xx), not a JSON-RPC answer: say it as one
      const message = parsed?.error?.message ?? parsed?.error ?? `HTTP ${res.status}`
      console.error(`[mcp-stdio] ${message}`)
      if (id !== null) out(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: String(message) } }))
      return
    }
    for (const a of answers(res.headers.get('content-type') ?? '', body)) out(a)
  } catch (err) {
    console.error(`[mcp-stdio] ${err.message}`)
    if (id !== null) out(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: `Purgatory at ${base} did not answer` } }))
  }
}

// One request at a time, in order: an answer never overtakes an earlier one
let queue = Promise.resolve()
createInterface({ input: process.stdin }).on('line', line => {
  if (line.trim()) queue = queue.then(() => forward(line))
}).on('close', () => { queue.then(() => process.exit(0)) })
