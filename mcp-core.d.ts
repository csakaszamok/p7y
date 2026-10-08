// The base image's /app/mcp-core.ts (csakaszamok/rododentron:0.3.0), for type checking only:
// it is not in this repository, server.ts imports it from the image.
export interface McpRoute { method: string; path: string; openapi: Record<string, unknown> }
export interface McpOptions {
  routesDir?: string
  name?: string
  version?: string
  forwardHeaders?: string[]
  include?: (r: McpRoute) => boolean
  maxResponseBytes?: number
}
export function createMcpHandler(opts?: McpOptions): (req: Request) => Promise<Response>
export function listMcpTools(opts?: McpOptions): Promise<Array<{ name: string; description: string; inputSchema: object; annotations?: object }>>
