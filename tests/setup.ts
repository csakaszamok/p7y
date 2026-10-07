import fs from 'fs'
import os from 'os'
import path from 'path'

// Tests never write to the real data directory (/app/data: not writable on CI's Linux, the live data on a dev box)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7y-test-data-'))
const defaults: Record<string, string> = {
  REGISTRY_AUTH_DIR: dir,
  ACCESS_TOKENS_FILE: path.join(dir, 'access-tokens.json'),
  SSH_KEYS_FILE: path.join(dir, 'ssh-keys.json'),
  REGISTRY_SCANS_FILE: path.join(dir, 'registry-scans.json'),
  REGISTRY_GC_FILE: path.join(dir, 'registry-gc.json'),
  REGISTRY_NOTIFY_SECRET_FILE: path.join(dir, 'registry-notify.secret'),
  DISK_USAGE_FILE: path.join(dir, 'disk-usage.json'),
  // Sandbox directories: empty temp dirs unless a test points them elsewhere
  SANDBOXES_DIR: path.join(dir, 'sandboxes'),
  LEGACY_USERS_DIR: path.join(dir, 'users'),
  ARCHIVE_DIR: path.join(dir, 'archive'),
  // Rendering a page never asks GitHub for the topbar's counts (tests/services/repoInfo.test.ts turns it on)
  GITHUB_STATS: 'off',
}
for (const [k, v] of Object.entries(defaults)) if (process.env[k] === undefined) process.env[k] = v
