import { html } from '../../services/ui/layout'
import { aboutPage } from '../../services/ui/aboutPage'

/** Public: the license notices and the source offer (AGPL-3.0 sections 5(d) and 13). */
export default async (_req: Request): Promise<Response> => html(aboutPage())
