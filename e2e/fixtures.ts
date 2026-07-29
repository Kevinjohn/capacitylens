import {
  expect,
  test as base,
  type APIRequestContext,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from "@playwright/test";

export { expect, type APIRequestContext, type Locator, type Page };

type PageErrorObserver = { observePage: (page: Page) => void };
type CapacityLensFixtures = {
  newObservedContext: (options?: BrowserContextOptions) => Promise<BrowserContext>;
  pageErrorObserver: PageErrorObserver;
};

/** Every browser spec fails if application code raises on any page registered with the fixture. */
export const test = base.extend<CapacityLensFixtures>({
  pageErrorObserver: [
    // Playwright requires a destructuring pattern even when an automatic fixture has no inputs.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const errors: Error[] = [];
      const observedPages = new Set<Page>();
      const recordError = (error: Error) => errors.push(error);
      const observePage = (page: Page) => {
        if (observedPages.has(page)) return;
        observedPages.add(page);
        page.on("pageerror", recordError);
      };
      await use({ observePage });
      observedPages.forEach((page) => page.off("pageerror", recordError));
      if (errors.length > 0) {
        const details = errors.map((error, index) => `${index + 1}. ${error.stack ?? error.message}`).join("\n\n");
        throw new Error(`Uncaught browser exception${errors.length === 1 ? "" : "s"}:\n\n${details}`);
      }
    },
    { auto: true },
  ],
  context: async ({ context, pageErrorObserver }, use) => {
    const observePage = pageErrorObserver.observePage;
    context.pages().forEach(observePage);
    context.on("page", observePage);
    try {
      await use(context);
    } finally {
      context.off("page", observePage);
    }
  },
  newObservedContext: async ({ browser, pageErrorObserver }, use) => {
    const contexts = new Set<BrowserContext>();
    const listeners = new Map<BrowserContext, (page: Page) => void>();
    await use(async (options) => {
      const context = await browser.newContext(options);
      const observePage = pageErrorObserver.observePage;
      context.pages().forEach(observePage);
      context.on("page", observePage);
      contexts.add(context);
      listeners.set(context, observePage);
      return context;
    });
    contexts.forEach((context) => context.off("page", listeners.get(context)!));
  },
});
