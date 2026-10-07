import { pageSession, redirect, html, renderPage, SANDBOX_VIEW_BODY } from '../../services/ui/layout'

export default async (req: Request): Promise<Response> => {
  const session = pageSession(req)
  if (!session) return redirect('/login')
  return html(renderPage({ title: 'My sandboxes', view: 'mine', session, body: SANDBOX_VIEW_BODY }))
}
