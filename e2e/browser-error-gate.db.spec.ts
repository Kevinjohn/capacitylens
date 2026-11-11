import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { test, expect } from './dbFixtures';

const probePrefix = 'BROWSER_ERROR_GATE_PROBE:';
const ackPrefix = '__browser_error_gate_ack__:';
const observerMessagePrefix = '__capacitylens_browser_error_observer__:';
const emptyDocument =
  '<!doctype html><html><head><title>Browser error gate</title></head><body></body></html>';

type ProbeExpectation =
  | { kind: 'error'; eventType: 'error' | 'unhandledrejection'; message: string }
  | { kind: 'observer-failure'; message: string };

function sentinel(id: string) {
  return `${probePrefix}${id}`;
}

function expectObserverFailure(testInfo: TestInfo, id: string, expected: ProbeExpectation) {
  testInfo.annotations.push({
    type: 'browser-error-probe',
    description: JSON.stringify({ id, ...expected }),
  });
  test.fail(true, `The browser error observer must report ${expected.message}.`);
}

function expectNativeErrorFailure(
  testInfo: TestInfo,
  id: string,
  eventType: 'error' | 'unhandledrejection',
) {
  expectObserverFailure(testInfo, id, { kind: 'error', eventType, message: sentinel(id) });
}

function waitForConsoleAck(page: Page, id: string) {
  const expected = `${ackPrefix}${id}`;
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error(`Missing native browser event ACK: ${id}`)),
      10_000,
    );
    const onConsole = (message: { text: () => string }) => {
      if (message.text() === expected) finish();
    };
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      page.off('console', onConsole);
      if (error) reject(error);
      else resolve();
    };
    page.on('console', onConsole);
  });
}

function waitForContextConsoleAck(context: BrowserContext, id: string) {
  const expected = `${ackPrefix}${id}`;
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error(`Missing native browser event ACK: ${id}`)),
      10_000,
    );
    const onConsole = (message: { text: () => string }) => {
      if (message.text() === expected) finish();
    };
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      context.off('console', onConsole);
      if (error) reject(error);
      else resolve();
    };
    context.on('console', onConsole);
  });
}

async function triggerErrorEvent(
  page: Page,
  id: string,
  eventType: 'error' | 'unhandledrejection',
  reasonKind: 'error' | 'primitive' = 'error',
) {
  const errorSentinel = sentinel(id);
  const ack = waitForConsoleAck(page, id);
  await page.evaluate(
    ({ eventType, errorSentinel, ackPrefix, id, reasonKind }) => {
      const acknowledge = () => setTimeout(() => console.debug(`${ackPrefix}${id}`), 0);
      if (eventType === 'error') {
        window.addEventListener(
          'error',
          (event) => {
            if (
              event.message === errorSentinel ||
              (event.error instanceof Error && event.error.message === errorSentinel)
            ) {
              acknowledge();
            }
          },
          true,
        );
        setTimeout(() => {
          throw new Error(errorSentinel);
        }, 0);
        return;
      }
      window.addEventListener(
        'unhandledrejection',
        (event) => {
          if (
            (typeof event.reason === 'object' &&
              event.reason !== null &&
              'message' in event.reason &&
              event.reason.message === errorSentinel) ||
            event.reason === errorSentinel
          ) {
            acknowledge();
          }
        },
        true,
      );
      void Promise.reject(reasonKind === 'primitive' ? errorSentinel : new Error(errorSentinel));
    },
    { eventType, errorSentinel, ackPrefix, id, reasonKind },
  );
  await ack;
}

function inlineErrorDocument(id: string) {
  const expected = sentinel(id);
  return `<script>
    addEventListener('error', event => {
      if (event.message === ${JSON.stringify(expected)} || event.error?.message === ${JSON.stringify(expected)}) setTimeout(() => console.debug(${JSON.stringify(`${ackPrefix}${id}`)}), 0);
    }, true);
    throw new Error(${JSON.stringify(expected)});
  </script>`;
}

async function openRoot(page: Page) {
  await page
    .context()
    .route('**/browser-error-gate-empty', (route) =>
      route.fulfill({ contentType: 'text/html', body: emptyDocument }),
    );
  await page.goto('/browser-error-gate-empty');
}

test('uncaught task ErrorEvent reaches the browser error gate', async ({ page }, testInfo) => {
  await openRoot(page);
  await triggerErrorEvent(page, 'sync-error', 'error');
  expectNativeErrorFailure(testInfo, 'sync-error', 'error');
});

test('an initial inline script ErrorEvent reaches the browser error gate', async ({
  page,
}, testInfo) => {
  const id = 'inline-sync-error';
  await page
    .context()
    .route('**/browser-error-gate-inline', (route) =>
      route.fulfill({ contentType: 'text/html', body: inlineErrorDocument(id) }),
    );
  const ack = waitForConsoleAck(page, id);
  await page.goto('/browser-error-gate-inline');
  await ack;
  expectNativeErrorFailure(testInfo, id, 'error');
});

test('native unhandledrejection reaches the browser error gate', async ({ page }, testInfo) => {
  await openRoot(page);
  await triggerErrorEvent(page, 'async-unhandled-rejection', 'unhandledrejection');
  expectNativeErrorFailure(testInfo, 'async-unhandled-rejection', 'unhandledrejection');
});

test('primitive unhandledrejection reaches the browser error gate', async ({ page }, testInfo) => {
  await openRoot(page);
  await triggerErrorEvent(page, 'primitive-unhandled-rejection', 'unhandledrejection', 'primitive');
  expectNativeErrorFailure(testInfo, 'primitive-unhandled-rejection', 'unhandledrejection');
});

test('the browser error gate remains active after reload', async ({ page }, testInfo) => {
  const id = 'post-reload-error';
  const expected = sentinel(id);
  let documentCount = 0;
  await page.context().route('**/browser-error-gate-reload', (route) => {
    documentCount += 1;
    const body =
      documentCount === 1
        ? emptyDocument
        : `<script>
            addEventListener('error', event => {
              if (event.message === ${JSON.stringify(expected)} || event.error?.message === ${JSON.stringify(expected)}) setTimeout(() => console.debug(${JSON.stringify(`${ackPrefix}${id}`)}), 0);
            }, true);
            setTimeout(() => { throw new Error(${JSON.stringify(expected)}); }, 0);
          </script>`;
    return route.fulfill({ contentType: 'text/html', body });
  });
  await page.goto('/browser-error-gate-reload');
  const ack = waitForConsoleAck(page, id);
  await page.reload();
  await ack;
  expectNativeErrorFailure(testInfo, id, 'error');
});

test('beforeunload ErrorEvent reaches the browser error gate', async ({ page }, testInfo) => {
  await openRoot(page);
  const id = 'beforeunload-error';
  const expected = sentinel(id);
  await page.evaluate(
    ({ expected, ackPrefix, id }) => {
      window.addEventListener(
        'error',
        (event) => {
          if (
            event.message === expected ||
            (event.error instanceof Error && event.error.message === expected)
          ) {
            setTimeout(() => console.debug(`${ackPrefix}${id}`), 0);
          }
        },
        true,
      );
      window.addEventListener('beforeunload', () => {
        throw new Error(expected);
      });
    },
    { expected, ackPrefix, id },
  );
  const ack = waitForConsoleAck(page, id);
  const navigation = page.waitForNavigation();
  await page.evaluate(() => window.location.reload());
  await Promise.all([navigation, ack]);
  expectNativeErrorFailure(testInfo, id, 'error');
});

test('registered secondary contexts are covered by the browser error gate', async ({
  page,
  newObservedContext,
}, testInfo) => {
  await openRoot(page);
  const context = await newObservedContext({ baseURL: new URL(page.url()).origin });
  await context.route('**/browser-error-gate-empty', (route) =>
    route.fulfill({ contentType: 'text/html', body: emptyDocument }),
  );
  const secondaryPage = await context.newPage();
  await secondaryPage.goto('/browser-error-gate-empty');
  await triggerErrorEvent(secondaryPage, 'secondary-context-error', 'error');
  expectNativeErrorFailure(testInfo, 'secondary-context-error', 'error');
});

test('iframe ErrorEvents reach the browser error gate', async ({ page }, testInfo) => {
  await openRoot(page);
  const id = 'iframe-error';
  const expected = sentinel(id);
  const ack = waitForConsoleAck(page, id);
  await page.context().route('**/browser-error-gate-frame', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<script>
        addEventListener('error', event => {
          if (event.message === ${JSON.stringify(expected)} || event.error?.message === ${JSON.stringify(expected)}) setTimeout(() => console.debug(${JSON.stringify(`${ackPrefix}${id}`)}), 0);
        }, true);
        setTimeout(() => { throw new Error(${JSON.stringify(expected)}); }, 0);
      </script>`,
    }),
  );
  await page.evaluate(() => {
    const iframe = document.createElement('iframe');
    iframe.src = '/browser-error-gate-frame';
    document.body.append(iframe);
  });
  await ack;
  expectNativeErrorFailure(testInfo, id, 'error');
});

test('popup ErrorEvents reach the browser error gate', async ({ page }, testInfo) => {
  await openRoot(page);
  const id = 'popup-error';
  await page
    .context()
    .route('**/browser-error-gate-popup', (route) =>
      route.fulfill({ contentType: 'text/html', body: inlineErrorDocument(id) }),
    );
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '/browser-error-gate-popup';
    link.target = '_blank';
    link.textContent = 'Open error probe popup';
    document.body.append(link);
  });
  const popupEvent = page.waitForEvent('popup');
  const ack = waitForContextConsoleAck(page.context(), id);
  await page.getByRole('link', { name: 'Open error probe popup' }).click();
  await popupEvent;
  await ack;
  expectNativeErrorFailure(testInfo, id, 'error');
});

test('an observed secondary-context fault remains a failure on close', async ({
  page,
  newObservedContext,
}, testInfo) => {
  await openRoot(page);
  const context = await newObservedContext({ baseURL: new URL(page.url()).origin });
  await context.route('**/browser-error-gate-empty', (route) =>
    route.fulfill({ contentType: 'text/html', body: emptyDocument }),
  );
  const secondaryPage = await context.newPage();
  await secondaryPage.goto('/browser-error-gate-empty');
  await triggerErrorEvent(secondaryPage, 'secondary-close-error', 'error');
  await context.close();
  expectNativeErrorFailure(testInfo, 'secondary-close-error', 'error');
});

test('null observer envelopes produce a structured observer failure', async ({
  page,
}, testInfo) => {
  await openRoot(page);
  const id = 'malformed-null-envelope';
  const ack = waitForConsoleAck(page, id);
  await page.evaluate(
    ({ ackPrefix, id, observerMessagePrefix }) => {
      console.debug(`${observerMessagePrefix}null`);
      setTimeout(() => console.debug(`${ackPrefix}${id}`), 0);
    },
    { ackPrefix, id, observerMessagePrefix },
  );
  await ack;
  expectObserverFailure(testInfo, id, {
    kind: 'observer-failure',
    message: 'BROWSER_ERROR_OBSERVER_ENVELOPE_SENTINEL:null',
  });
});

test('array observer envelopes produce a structured observer failure', async ({
  page,
}, testInfo) => {
  await openRoot(page);
  const id = 'malformed-array-envelope';
  const expected = 'BROWSER_ERROR_OBSERVER_ENVELOPE_SENTINEL:[]';
  const ack = waitForConsoleAck(page, id);
  await page.evaluate(
    ({ ackPrefix, id, observerMessagePrefix }) => {
      console.debug(`${observerMessagePrefix}[]`);
      setTimeout(() => console.debug(`${ackPrefix}${id}`), 0);
    },
    { ackPrefix, id, observerMessagePrefix },
  );
  await ack;
  expectObserverFailure(testInfo, id, { kind: 'observer-failure', message: expected });
});

test('missing observer fields produce a structured observer failure', async ({
  page,
}, testInfo) => {
  await openRoot(page);
  const id = 'malformed-missing-field';
  const expected = sentinel(id);
  const ack = waitForConsoleAck(page, id);
  await page.evaluate(
    ({ ackPrefix, id, observerMessagePrefix, expected }) => {
      console.debug(
        `${observerMessagePrefix}${JSON.stringify({
          channel: observerMessagePrefix.slice(0, -1),
          kind: 'error',
          eventType: 'error',
          name: 'Error',
          message: expected,
          url: location.href,
        })}`,
      );
      setTimeout(() => console.debug(`${ackPrefix}${id}`), 0);
    },
    { ackPrefix, id, observerMessagePrefix, expected },
  );
  await ack;
  expectObserverFailure(testInfo, id, { kind: 'observer-failure', message: expected });
});

test('invalid observer fields produce a structured observer failure', async ({
  page,
}, testInfo) => {
  await openRoot(page);
  const id = 'malformed-field-envelope';
  const expected = sentinel(id);
  const ack = waitForConsoleAck(page, id);
  await page.evaluate(
    ({ ackPrefix, id, observerMessagePrefix, expected }) => {
      console.debug(
        `${observerMessagePrefix}${JSON.stringify({
          channel: observerMessagePrefix.slice(0, -1),
          token: 'malformed-field-probe',
          kind: 'error',
          eventType: 42,
          message: expected,
          name: 'Error',
          url: location.href,
        })}`,
      );
      setTimeout(() => console.debug(`${ackPrefix}${id}`), 0);
    },
    { ackPrefix, id, observerMessagePrefix, expected },
  );
  await ack;
  expectObserverFailure(testInfo, id, { kind: 'observer-failure', message: expected });
});

test('resource error events do not fail the browser error gate', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-error-control', description: 'resource-error-event' });
  await openRoot(page);
  const id = 'resource-error-event';
  await page
    .context()
    .route('**/browser-error-gate-missing-resource', (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: '' }),
    );
  const ack = waitForConsoleAck(page, id);
  await page.evaluate(
    ({ ackPrefix, id }) => {
      const image = document.createElement('img');
      image.onerror = () => console.debug(`${ackPrefix}${id}`);
      image.src = '/browser-error-gate-missing-resource';
      document.body.append(image);
    },
    { ackPrefix, id },
  );
  await ack;
});

test('caught rejection and canceled background read during reload do not fail the gate', async ({
  page,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'browser-error-control',
    description: 'caught-cancelled-read',
  });
  await openRoot(page);
  const caught = await page.evaluate(async () => {
    try {
      await Promise.reject(new Error('expected caught rejection control'));
      return false;
    } catch {
      return true;
    }
  });
  expect(caught).toBe(true);

  let releaseRoute!: () => void;
  let signalRoute!: () => void;
  const routeStarted = new Promise<void>((resolve) => (signalRoute = resolve));
  const routeGate = new Promise<void>((resolve) => (releaseRoute = resolve));
  await page.route('**/api/accounts/a-studio/resource-avatars', async (route) => {
    signalRoute();
    await routeGate;
    await route.abort().catch(() => undefined);
  });
  const readCancelled = page.waitForEvent('requestfailed', (request) =>
    request.url().includes('/api/accounts/a-studio/resource-avatars'),
  );
  const caughtAck = waitForConsoleAck(page, 'caught-resource-read');
  const navigationAck = waitForConsoleAck(page, 'cancelled-read-navigation');
  await page.evaluate(
    ({ ackPrefix }) => {
      window.addEventListener('beforeunload', () => {
        console.debug(`${ackPrefix}cancelled-read-navigation`);
      });
      void fetch('/api/accounts/a-studio/resource-avatars').catch(() => {
        console.debug(`${ackPrefix}caught-resource-read`);
      });
    },
    { ackPrefix },
  );
  await routeStarted;
  const reload = page.reload();
  await navigationAck;
  releaseRoute();
  await Promise.all([readCancelled, caughtAck, reload]);
});
