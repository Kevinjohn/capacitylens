import type { Page } from "@playwright/test";

export interface RequestFailureGate {
  attempts: () => number;
  release: () => void;
}

/** Return the selected browser requests as failures until the test releases the gate.
 *  The rest of the browser, API and database remain real so resilience specs exercise
 *  the production recovery path rather than replacing the application with mocks. */
export async function failRequestsUntilReleased(
  page: Page,
  url: string,
  response: { status: number; body: Record<string, unknown> },
): Promise<RequestFailureGate> {
  let released = false;
  let attempts = 0;

  await page.route(url, async (route) => {
    if (released) {
      await route.fallback();
      return;
    }

    attempts += 1;
    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      body: JSON.stringify(response.body),
    });
  });

  return {
    attempts: () => attempts,
    release: () => {
      released = true;
    },
  };
}
