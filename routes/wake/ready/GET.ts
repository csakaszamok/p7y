import { appReady } from '../../../services/appReady'

// Public, like the waiting page that asks it from the sandbox's own host: only whether an app answers yet
export default async (req: Request): Promise<Response> => {
  const host = new URL(req.url).searchParams.get('host')
  const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }
  if (!host) return Response.json({ error: 'Give a host' }, { status: 400, headers })
  return Response.json(await appReady(host), { headers })
}
