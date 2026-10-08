import { getPrincipal, scopedTokenAllows, type Principal } from './principal'

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

/** Who calls /mcp: only a token (an access token or ADMIN_TOKEN), else a 401. The tools get only the Authorization
 * header, not the session cookie, so a browser session could list the tools but not call one. */
export function mcpCaller(req: Request): Principal | Response {
  const p = getPrincipal(req)
  if (p && p.via !== 'session') return p
  return Response.json({ error: 'Unauthorized: send an access token (Authorization: Bearer p7y_…)' }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
}

/** The tools this caller sees: a token limited to one sandbox only those it may call (the REST API's own list,
 * with that sandbox in the path), so its agent is not offered tools that would answer 403. */
export function mcpToolsFor(p: Principal): (r: McpRoute) => boolean {
  return r => mcpInclude(r) && (!p.sandbox || scopedTokenAllows(r.method, r.path.replace(/\{[^}]+\}/g, p.sandbox)))
}
