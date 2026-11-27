import type { Page, Request } from '@playwright/test'

/** Exposes the intercepted-request count and releases matching requests back to the network. */
export interface RequestFailureGate {
  attempts: () => number
  release: () => void
}

/** Return the selected browser requests (matching `url` and `matches`) as failures until the test releases the gate.
 * The rest of the browser, API and database remain real so resilience specs exercise
 * the production recovery path rather than replacing the application with mocks. */
export async function failRequestsUntilReleased(
  page: Page,
  url: string | RegExp,
  response: { status: number; body: Record<string, unknown> },
  matches: (request: Request) => boolean = () => true
): Promise<RequestFailureGate> {
  let released = false
  let attempts = 0

  await page.route(url, async (route) => {
    if (released || !matches(route.request())) {
      await route.fallback()
      return
    }

    attempts += 1
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })

  return {
    attempts: () => attempts,
    release: () => {
      released = true
    },
  }
}
