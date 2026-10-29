/** The address a request came from, as Traefik (in front of every request) tells it; null when it does not */
export function clientIp(req: Request): string | null {
  const real = req.headers.get('x-real-ip')?.trim()
  if (real) return real
  // Traefik appends the address it saw last
  const forwarded = req.headers.get('x-forwarded-for')?.split(',').map(s => s.trim()).filter(Boolean)
  return forwarded?.length ? forwarded[forwarded.length - 1] : null
}
