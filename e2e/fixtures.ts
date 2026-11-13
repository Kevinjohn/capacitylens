import { expect, test as base } from '@playwright/test';
import type {
  APIRequestContext,
  BrowserContext,
  BrowserContextOptions,
  Locator,
  Page,
} from '@playwright/test';
import { clearAuthE2ECompanies, waitForAuthE2EBaseline } from './authTestSupport';

export { expect, type APIRequestContext, type Locator, type Page };

type PageErrorObserver = { observePage: (page: Page) => void };
type CapacityLensFixtures = {
  authCompanyIsolation: void;
  newObservedContext: (options?: BrowserContextOptions) => Promise<BrowserContext>;
  pageErrorObserver: PageErrorObserver;
};

/**
 * WebKit refuses a fetch started while its document unloads and logs the refusal as a JavaScript
 * console error, which Playwright reports as a page error even when the application handles the
 * rejection. A same-origin request is never subject to an access-control check, so only that
 * shape is ignored; a cross-origin denial still fails the test.
 */
function isWebKitUnloadFetchRefusal(error: Error, page: Page, browserName: string): boolean {
  if (browserName !== 'webkit') return false;
  // Playwright splits the message at its first colon, so the whole URL survives only in the stack.
  const url = /^Fetch API cannot load (\S+) due to access control checks\.$/.exec(
    error.stack?.split('\n', 1)[0] ?? '',
  )?.[1];
  return (
    url !== undefined &&
    URL.canParse(url) &&
    URL.canParse(page.url()) &&
    new URL(url).origin === new URL(page.url()).origin
  );
}

/** Every browser spec fails if application code raises on any page registered with the fixture. */
export const test = base.extend<CapacityLensFixtures>({
  authCompanyIsolation: [
    // Playwright requires a destructuring pattern for an automatic fixture with no inputs.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, testInfo) => {
      if (testInfo.project.name === 'auth-backed') {
        await waitForAuthE2EBaseline();
        clearAuthE2ECompanies();
      }
      try {
        await use();
      } finally {
        if (testInfo.project.name === 'auth-backed') clearAuthE2ECompanies();
      }
    },
    { auto: true },
  ],
  pageErrorObserver: [
    async ({ browserName }, use) => {
      const errors: Error[] = [];
      const observedPages = new Map<Page, (error: Error) => void>();
      const observePage = (page: Page) => {
        if (observedPages.has(page)) return;
        const recordError = (error: Error) => {
          if (!isWebKitUnloadFetchRefusal(error, page, browserName)) errors.push(error);
        };
        observedPages.set(page, recordError);
        page.on('pageerror', recordError);
      };
      await use({ observePage });
      observedPages.forEach((recordError, page) => page.off('pageerror', recordError));
      if (errors.length > 0) {
        const details = errors
          .map((error, index) => `${index + 1}. ${error.stack ?? error.message}`)
          .join('\n\n');
        throw new Error(
          `Uncaught browser exception${errors.length === 1 ? '' : 's'}:\n\n${details}`,
        );
      }
    },
    { auto: true },
  ],
  context: async ({ context, pageErrorObserver }, use) => {
    const observePage = pageErrorObserver.observePage;
    context.pages().forEach(observePage);
    context.on('page', observePage);
    try {
      await use(context);
    } finally {
      context.off('page', observePage);
    }
  },
  newObservedContext: async ({ browser, pageErrorObserver }, use) => {
    const observePage = pageErrorObserver.observePage;
    const contexts: BrowserContext[] = [];
    try {
      await use(async (options) => {
        const context = await browser.newContext(options);
        context.pages().forEach(observePage);
        context.on('page', observePage);
        contexts.push(context);
        return context;
      });
    } finally {
      // Close whatever the spec left open so no secondary context outlives its test.
      await Promise.all(
        contexts.map(async (context) => {
          context.off('page', observePage);
          await context.close();
        }),
      );
    }
  },
});
