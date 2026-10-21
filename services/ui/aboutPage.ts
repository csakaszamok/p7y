import { escapeHtml } from './layout'
import { faviconTag } from './brand'
import { p7yVersion, REPO } from '../repoInfo'

/**
 * The Appropriate Legal Notices of AGPL-3.0 section 5(d) and the source offer of section 13, for anyone who uses
 * the web interface. Always names Purgatory (NOTICE, additional term (b)): UI_TITLE and UI_LOGO do not change it.
 * A modified version links to its own source here and marks itself as changed (NOTICE, (c)).
 */
export function aboutPage(): string {
  const version = p7yVersion()
  const source = `https://github.com/${REPO}${version ? `/tree/v${escapeHtml(version)}` : ''}`
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>About</title><link rel="stylesheet" href="/assets/style.css">
${faviconTag()}</head>
<body class="login">
<main class="card about">
  <h1>About</h1>
  <p><strong>Based on Purgatory (p7y)</strong>, <a href="https://github.com/${REPO}">https://github.com/${REPO}</a>${version ? `, version ${escapeHtml(version)}` : ''}.</p>
  <p>Copyright 2026 the Purgatory (p7y) authors. Free software under the
    <a href="https://www.gnu.org/licenses/agpl-3.0.html">GNU Affero General Public License, version 3</a>:
    you may use, study, share and change it under its terms.</p>
  <p><a href="${source}">The source code of this version</a></p>
  <p class="muted">It comes without any warranty, to the extent permitted by law; see the license for details.</p>
  <p><a href="/">Back</a></p>
</main>
</body></html>`
}
