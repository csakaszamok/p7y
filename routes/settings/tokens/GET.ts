import { pageSession, redirect, html, renderPage, TOKENS_VIEW_BODY } from '../../../services/ui/layout'

export default async (req: Request): Promise<Response> => {
  const session = pageSession(req)
  if (!session) return redirect('/login')
  return html(renderPage({ title: 'Access tokens', view: 'tokens', session, body: TOKENS_VIEW_BODY }))
}
