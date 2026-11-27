import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'

// A page address is single-slash segments of URL-safe characters. Only such an address is ever a
// redirect target, so a trailing-slash request cannot be answered with a link to another host.
const PAGE_ADDRESS = /^(?:\/[\w.~%-]+)+$/

/** Serves the SPA for any page address no other route matches (the history fallback). */
export default class SpaFallbackController {
  handle({ request, response }: HttpContext) {
    const path = request.url().split('?', 1)[0]
    // A page address typed with a trailing slash opens the same page at the address without it.
    const page = path === '/' ? path : path.replace(/\/+$/, '')
    const lastSegment = page.slice(page.lastIndexOf('/') + 1)
    if (
      path.startsWith('/assets/') ||
      path.startsWith('/api/') ||
      lastSegment.includes('.') ||
      (page !== path && !PAGE_ADDRESS.test(page))
    ) {
      return response.notFound('Not found')
    }
    if (page !== path) {
      // The query string is forwarded as it arrived; the redirect helper would rewrite it.
      const raw = request.request.url ?? ''
      const query = raw.includes('?') ? raw.slice(raw.indexOf('?')) : ''
      return response.redirect().status(301).clearQs().toPath(`${page}${query}`)
    }
    response.header('Cache-Control', 'no-store')
    return response.download(app.publicPath('index.html'))
  }
}
