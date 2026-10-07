import { pageSession, redirect, html, renderPage, SANDBOX_VIEW_BODY } from '../../services/ui/layout'

export default async (req: Request): Promise<Response> => {
  const session = pageSession(req)
  if (!session) return redirect('/login')
  if (session.role !== 'admin') return redirect('/')
  return html(renderPage({ title: 'All sandboxes', view: 'all', session, body: SANDBOX_VIEW_BODY }))
}
