import fs from 'fs'
import path from 'path'

const ASSETS: Record<string, string> = {
  'app.js': 'text/javascript; charset=utf-8',
  'embers.js': 'text/javascript; charset=utf-8',
  'waiting.js': 'text/javascript; charset=utf-8',
  'style.css': 'text/css; charset=utf-8',
  'logo.svg': 'image/svg+xml',
  'terminal.js': 'text/javascript; charset=utf-8',
  'logs.js': 'text/javascript; charset=utf-8',
  'panel.js': 'text/javascript; charset=utf-8',
  'xterm.js': 'text/javascript; charset=utf-8',
  'addon-fit.js': 'text/javascript; charset=utf-8',
  'xterm.css': 'text/css; charset=utf-8',
}

export default async (req: Request): Promise<Response> => {
  const file = new URL(req.url).pathname.split('/')[2]
  const type = ASSETS[file]
  if (!type) return new Response('Not found', { status: 404 })
  const body = fs.readFileSync(path.join(process.cwd(), 'ui', file))
  return new Response(body, { headers: { 'Content-Type': type, 'Cache-Control': 'no-cache' } })
}
