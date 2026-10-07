import { issueToken, verifyPassword } from '../../../services/registryAuth'
import { grantFor, type Who } from '../../../services/registryAccess'
import { registryHashOf } from '../../../services/registryPasswords'
import { resolveToken } from '../../../services/tokens'
import { publicPullAllowed } from '../../../services/registryScans'
import { sandboxService } from '../../../services/sandbox'
import { rawNameOf } from '../../../services/naming'
import { isAdminToken } from '../../../services/principal'

const unauthorized = () => Response.json(
  { errors: [{ code: 'UNAUTHORIZED', message: 'invalid credentials' }] },
  { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="p7y"' } },
)

/** Who the Basic credentials are: the admin token, a p7y token (any user name), or a sandbox's registry password. */
async function whoIs(authHeader: string): Promise<Who | null> {
  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8')
  const i = decoded.indexOf(':')
  if (i === -1) return null
  const user = decoded.slice(0, i), password = decoded.slice(i + 1)
  const admin = process.env.ADMIN_TOKEN
  if (admin && isAdminToken(password, admin)) return { kind: 'admin' }
  if (password.startsWith('p7y_') || password.startsWith('ldr_')) {
    const t = resolveToken(password)
    if (!t) return null
    return t.sandbox ? { kind: 'sandbox', raw: rawNameOf(t.sandbox) ?? t.sandbox } : { kind: 'owner', owner: t.owner }
  }
  const hash = registryHashOf(user)
  return hash && await verifyPassword(password, hash) ? { kind: 'sandbox', raw: user } : null
}

/** The registry's token endpoint: tokens, registry passwords, or nobody (anonymous pull of scanned images). */
export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url)
  const service = url.searchParams.get('service') ?? ''
  const scope = url.searchParams.getAll('scope').join(' ')
  const auth = req.headers.get('Authorization') ?? ''
  let who: Who
  if (!auth) who = { kind: 'anonymous' }
  else if (!auth.startsWith('Basic ')) return unauthorized()
  else {
    // A wrong password is an error, never a silent anonymous pull
    const found = await whoIs(auth)
    if (!found) return unauthorized()
    who = found
  }
  const sandboxes = who.kind === 'owner' ? await sandboxService.listSandboxes() : []
  const publicPull = (process.env.REGISTRY_PUBLIC_PULL ?? 'true') !== 'false'
  // Anonymous pull per repo: every version scanned and clean, and nothing in the registry p7y has not scanned
  const repos = [...new Set(scope.split(' ').filter(s => s.startsWith('repository:')).map(s => s.split(':')[1]))]
  const clean = new Map(publicPull ? await Promise.all(repos.map(async r => [r, await publicPullAllowed(r)] as const)) : [])
  const access = grantFor(who, scope, {
    publicPull,
    repoIsClean: r => clean.get(r) === true,
    ownedRaw: owner => sandboxes.filter(s => s.owner === owner).map(s => rawNameOf(s.name) ?? s.name),
  })
  const subject = who.kind === 'sandbox' ? who.raw : who.kind === 'owner' ? who.owner : who.kind
  const token = issueToken(subject, service, access)
  return Response.json({ token, access_token: token })
}
