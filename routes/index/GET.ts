import { html, renderPage, SANDBOX_VIEW_BODY } from '../../services/ui/layout'
import { guiSession } from '../../services/ui/headlessPage'

export default async (req: Request): Promise<Response> => {
  const session = guiSession(req)
  if (session instanceof Response) return session
  return html(renderPage({ title: 'My sandboxes', view: 'mine', session, body: SANDBOX_VIEW_BODY }))
}
