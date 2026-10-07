import { pageSession, redirect, html, renderPage, SSH_KEYS_VIEW_BODY } from '../../../services/ui/layout'

export default async (req: Request): Promise<Response> => {
  const session = pageSession(req)
  if (!session) return redirect('/login')
  return html(renderPage({ title: 'SSH keys', view: 'ssh-keys', session, body: SSH_KEYS_VIEW_BODY }))
}
