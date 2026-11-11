import { expect, test as base } from '@playwright/test';
import type {
  APIRequestContext,
  BrowserContext,
  BrowserContextOptions,
  Locator,
  Page,
} from '@playwright/test';
import { createBrowserErrorObserver, formatObserverMessage } from './browserErrorObserver';
import { clearAuthE2ECompanies, waitForAuthE2EBaseline } from './authTestSupport';

export { expect, type APIRequestContext, type Locator, type Page };

type BrowserErrorObserver = {
  registerContext: (context: BrowserContext) => Promise<void>;
  observePage: (page: Page) => void;
  waitForPage: (page: Page) => Promise<void>;
  assertContextReady: (context: BrowserContext) => Promise<void>;
};
type CapacityLensFixtures = {
  authCompanyIsolation: void;
  newObservedContext: (options?: BrowserContextOptions) => Promise<BrowserContext>;
  pageErrorObserver: BrowserErrorObserver;
};

/** Browser specs fail when a registered context emits an uncaught browser error event. */
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
    // Playwright requires a destructuring pattern even when an automatic fixture has no inputs.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, testInfo) => {
      const observer = createBrowserErrorObserver();
      const {
        errors,
        driverPageErrors,
        registerContext,
        observePage,
        waitForPage,
        assertContextReady,
      } = observer;
      try {
        await use({ observePage, registerContext, waitForPage, assertContextReady });
      } finally {
        await observer.dispose();
      }
      if (driverPageErrors.length > 0) {
        await testInfo.attach('browser-pageerror-diagnostics', {
          body: Buffer.from(
            driverPageErrors.map((error) => error.stack ?? error.message).join('\n\n'),
          ),
          contentType: 'text/plain',
        });
      }
      if (errors.length > 0) {
        await testInfo.attach('browser-observer-lifecycle-diagnostics', {
          body: Buffer.from(JSON.stringify(observer.lifecycleDiagnostics, null, 2)),
          contentType: 'application/json',
        });
        if (
          testInfo.annotations.some((annotation) => annotation.type.startsWith('browser-error-'))
        ) {
          testInfo.annotations.push({
            type: 'browser-error-observer-records',
            description: JSON.stringify(errors),
          });
        }
        const details = errors.map((message, index) => {
          const error = formatObserverMessage(message);
          return `${index + 1}. ${error.stack ?? error.message}`;
        });
        const coverageFailure = errors.some((message) => message.kind === 'coverage-failure');
        throw new Error(
          `${coverageFailure ? 'Browser error observer coverage failure' : 'Uncaught browser error event'}${errors.length === 1 ? '' : 's'}:\n\n${details.join('\n\n')}`,
        );
      }
    },
    { auto: true },
  ],
  context: async ({ context, pageErrorObserver }, use) => {
    await pageErrorObserver.registerContext(context);
    try {
      await use(context);
    } finally {
      await pageErrorObserver.assertContextReady(context);
    }
  },
  newObservedContext: async ({ browser, pageErrorObserver }, use) => {
    const contexts = new Set<BrowserContext>();
    try {
      await use(async (options) => {
        const context = await browser.newContext(options);
        contexts.add(context);
        await pageErrorObserver.registerContext(context);
        return context;
      });
    } finally {
      await Promise.all(
        [...contexts].map(async (context) => {
          await pageErrorObserver.assertContextReady(context);
          await context.close();
        }),
      );
    }
  },
});
