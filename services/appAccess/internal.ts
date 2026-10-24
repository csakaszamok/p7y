/**
 * Paths only Traefik asks, on Purgatory's internal port (not published like the API port, not routed by Traefik):
 * the forwardAuth decision, the HTTP provider's middlewares and the error-page middleware's 404 page. Elsewhere they
 * are 404, so nobody outside learns the sandboxes' names or their apps' levels from them.
 */
export const INTERNAL_PORT = 3001
const INTERNAL = new Set(['/auth/app', '/traefik/access', '/errors/404'])
export const internalOnly = (path: string): boolean => INTERNAL.has(path.replace(/\/+$/, '') || '/')
