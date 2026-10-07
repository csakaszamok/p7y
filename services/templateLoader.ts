import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { CATALOG_NAME, loadAll } from './runtimeLoader'

/** What runs inside a sandbox: templates/<name>/compose.yaml, plus an optional templates/<name>/template.yaml. */
export interface SandboxTemplate {
  name: string
  description: string
  /** The stack deployed into the sandbox's own Docker on creation (compose.yaml). */
  compose: Record<string, unknown>
  /** Runs before the stack is written; what it returns becomes ${variables} and the sandbox's extras. */
  before_script?: string
  /** Sablier session duration: stop the sandbox after this long without HTTP traffic (Go duration, e.g. "30m"). */
  idle_timeout?: string
  /** Take a sandbox down after it has been stopped this long ("30m", "12h", "7d" or "off"). Default 7d. */
  deep_sleep_after?: string
  /** Compose project name of the stack inside (default "inner"). */
  inner_project_name?: string
}

const defaultDir = () => process.env.TEMPLATES_DIR ?? '/app/templates'

export function loadTemplate(name: string, dir = defaultDir()): SandboxTemplate {
  const composeFile = path.join(dir, name, 'compose.yaml')
  if (!CATALOG_NAME.test(name) || !fs.existsSync(composeFile)) throw new Error(`Template not found: ${name}`)
  const metaFile = path.join(dir, name, 'template.yaml')
  const loaded = fs.existsSync(metaFile) ? yaml.load(fs.readFileSync(metaFile, 'utf8')) : null
  const meta = (loaded && typeof loaded === 'object' ? loaded : {}) as Partial<SandboxTemplate>
  const compose = (yaml.load(fs.readFileSync(composeFile, 'utf8')) ?? {}) as Record<string, unknown>
  return {
    name,
    description: meta.description ?? name,
    compose,
    ...(meta.before_script ? { before_script: meta.before_script } : {}),
    ...(meta.idle_timeout ? { idle_timeout: meta.idle_timeout } : {}),
    ...(meta.deep_sleep_after ? { deep_sleep_after: meta.deep_sleep_after } : {}),
    ...(meta.inner_project_name ? { inner_project_name: meta.inner_project_name } : {}),
  }
}

/** compose.yaml as written (comments, ${variables}), for showing and editing before a create. */
export function loadTemplateText(name: string, dir = defaultDir()): string {
  const composeFile = path.join(dir, name, 'compose.yaml')
  if (!CATALOG_NAME.test(name) || !fs.existsSync(composeFile)) throw new Error(`Template not found: ${name}`)
  return fs.readFileSync(composeFile, 'utf8')
}

export function listTemplates(dir = defaultDir()): SandboxTemplate[] {
  if (!fs.existsSync(dir)) return []
  const names = fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && CATALOG_NAME.test(d.name) && fs.existsSync(path.join(dir, d.name, 'compose.yaml')))
    .map(d => d.name)
  return loadAll('template', names, n => loadTemplate(n, dir)).sort((a, b) => a.name.localeCompare(b.name))
}
