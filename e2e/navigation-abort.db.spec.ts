import { test } from './dbFixtures'
import { openApp } from './browserTestKit'

// WebKit refuses a fetch started while its document unloads and reports the refusal as a page
// error even though the application handles the rejection. The page-error gate ignores only the
// same-origin shape of that report. A database worker serves the app and its API from one origin
// under the product's `connect-src 'self'` policy, which refuses a cross-origin fetch before WebKit
// reaches that check, so only the same-origin shape can arise here.
function fetchOnPageHide(page: Parameters<typeof openApp>[0], url: string): Promise<void> {
  return page.evaluate((target) => {
    window.addEventListener('pagehide', () => {
      void fetch(target).catch(() => undefined)
    })
  }, url)
}

test(
  'a handled same-origin fetch started during unload passes the page-error gate',
  { tag: '@engine' },
  async ({ page }) => {
    await openApp(page)
    await fetchOnPageHide(page, '/api/v1/companies/a-studio/planning')
    await openApp(page)
  }
)
