import { expect, test as base } from "@playwright/test";
import type { APIRequestContext, BrowserContext, BrowserContextOptions, Locator, Page } from "@playwright/test";
import { dbBrowserSessionCookies, signInDbBootstrap } from "./dbAuthenticationSupport";

export { expect, type APIRequestContext, type Locator, type Page };

type PageErrorObserver = { observePage: (page: Page) => void };
type CapacityLensFixtures = {
  dbSessionReady: boolean;
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
  dbSessionReady: [
    async ({ request }, use, testInfo) => {
      const isDbBacked = testInfo.project.name === "db-backed";
      if (isDbBacked) await signInDbBootstrap(request);
      await use(isDbBacked);
    },
    { auto: true },
  ],
  context: async ({ context, pageErrorObserver, request, dbSessionReady }, use, testInfo) => {
    if (dbSessionReady) {
      const cookies = await dbBrowserSessionCookies(request, testInfo.project.use.baseURL);
      await context.addCookies(cookies);
    }
    const observePage = pageErrorObserver.observePage;
    context.pages().forEach(observePage);
    context.on("page", observePage);
    try {
      await use(context);
    } finally {
      context.off("page", observePage);
    }
  },
  newObservedContext: async ({ browser, pageErrorObserver, request, dbSessionReady }, use, testInfo) => {
    const contexts = new Set<BrowserContext>();
    const listeners = new Map<BrowserContext, (page: Page) => void>();
    await use(async (options) => {
      const context = await browser.newContext(options);
      if (dbSessionReady && options?.storageState === undefined) {
        const appOrigin = options?.baseURL ?? testInfo.project.use.baseURL;
        const cookies = await dbBrowserSessionCookies(request, appOrigin);
        await context.addCookies(cookies);
      }
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
