import { startResponse } from '../../../../services/appAccess/start'

export const openapi = {
  mcp: false,
  summary: 'Sign in for a sandbox app open to its domain or owner, then back to it',
  tags: ['auth'],
  responses: { 302: { description: 'to the app with a ticket' }, 303: { description: 'to sign-in' }, 400: { description: 'not an app address' }, 403: { description: 'not open to this account' } },
}

export default (req: Request): Promise<Response> => startResponse(req)
