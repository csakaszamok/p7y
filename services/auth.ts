export function isAdmin(req: Request): boolean {
  const token = process.env.ADMIN_TOKEN
  if (!token) return false
  const auth = req.headers.get('Authorization') ?? ''
  return auth === `Bearer ${token}`
}

export function adminGuard(req: Request): Response | null {
  if (isAdmin(req)) return null
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}
