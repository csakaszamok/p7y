import { html, renderPage, SSH_KEYS_VIEW_BODY } from '../../../services/ui/layout'
import { guiSession } from '../../../services/ui/headlessPage'

export default async (req: Request): Promise<Response> => {
  const session = guiSession(req)
  if (session instanceof Response) return session
  return html(renderPage({ title: 'SSH keys', view: 'ssh-keys', session, body: SSH_KEYS_VIEW_BODY }))
}
