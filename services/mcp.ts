import { getPrincipal } from './principal'

/**
 * Purgatory as an MCP server, at /mcp (Streamable HTTP), from the base image's mcp-core: every API route is a tool.
 * Each tool call runs the route itself with the caller's Authorization header, so a tool can do exactly what
 * the same token can do on the REST API (a token limited to one sandbox stays limited to it).
 */

export interface McpRoute { method: string; path: string; openapi: Record<string, unknown> }

/** API routes only: those with an OpenAPI summary (not the pages, login, wake or registry auth), unless `mcp: false`. */
export function mcpInclude(r: McpRoute): boolean {
  return typeof r.openapi.summary === 'string' && r.openapi.mcp !== false
}

/** 401 unless the request carries a token (an access token or ADMIN_TOKEN): the tools get only the Authorization
 * header, not the session cookie, so a browser session could list the tools but not call one. */
export function mcpGate(req: Request): Response | null {
  const p = getPrincipal(req)
  if (p && p.via !== 'session') return null
  return Response.json({ error: 'Unauthorized: send an access token (Authorization: Bearer p7y_…)' }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
}
