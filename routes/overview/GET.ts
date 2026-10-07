import { pageSession, redirect, html, renderPage, OVERVIEW_BODY } from '../../services/ui/layout'

export default async (req: Request): Promise<Response> => {
  const session = pageSession(req)
  if (!session) return redirect('/login')
  return html(renderPage({ title: 'Overview', view: 'overview', session, body: OVERVIEW_BODY }))
}
