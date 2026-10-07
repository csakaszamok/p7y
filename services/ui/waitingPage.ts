import fs from 'fs'
import path from 'path'

// A waiting page is served on the sandbox's own host (Sablier's theme, or Purgatory's /wake
// through the catch-all router), where Purgatory's /assets are not reachable: everything it
// needs is inlined. The same files are inlined into sablier-themes/*.html (a test keeps them equal).
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), 'ui', f), 'utf8').trim()

/** The flame shown once the sandbox is ready (the logo's flame, without its coal). */
export const READY_FLAME = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="p7y-wf" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff5a00"/><stop offset=".6" stop-color="#ff9a2e"/><stop offset="1" stop-color="#ffe0a0"/></linearGradient></defs><path fill="url(#p7y-wf)" d="M32 4c5 13 18 19 18 36a18 18 0 0 1-36 0c0-11 7-15 9-24 4 5 6 10 5 16 6-7 8-15 4-28Z"/><path fill="#fff1c9" d="M32 30c3 5 7 7 7 13a7 7 0 0 1-14 0c0-4 3-6 4-9 1 2 2 4 2 6 2-3 2-6 1-10Z"/></svg>`

export function waitingPage(opts: { title: string; name: string; body: string; refreshSeconds: number }): string {
  const { title, name, body, refreshSeconds } = opts
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<noscript><meta http-equiv="refresh" content="${refreshSeconds}"></noscript>
<title>${title} — ${name}</title>
<style>
${read('waiting.css')}
</style>
</head>
<body>
<canvas data-embers aria-hidden="true" style="position:fixed;inset:0;width:100%;height:100%;pointer-events:none"></canvas>
<div class="heat"></div>
<div class="wrap"><div class="card" data-p7y-waiting data-refresh="${refreshSeconds}">
  <div class="coal" data-coal><div class="core"></div>${READY_FLAME}</div>
  <h1>${title}</h1>
  <div class="name">${name}</div>
  ${body}
</div></div>
<script>
${read('embers.js')}
</script>
<script>
${read('waiting.js')}
</script>
</body>
</html>`
}
