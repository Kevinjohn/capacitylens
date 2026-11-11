import type { BrowserContext, ConsoleMessage, Frame, Page, TestInfo } from '@playwright/test';
import { test, expect } from './dbFixtures';
import { createBrowserErrorObserver } from './browserErrorObserver';

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

test('the browser error gate remains active after reload', async ({
  page,
  pageErrorObserver,
}, testInfo) => {
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
  await pageErrorObserver.waitForPage(page);
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
  pageErrorObserver,
}, testInfo) => {
  await openRoot(page);
  const context = await newObservedContext({ baseURL: new URL(page.url()).origin });
  await context.route('**/browser-error-gate-empty', (route) =>
    route.fulfill({ contentType: 'text/html', body: emptyDocument }),
  );
  const secondaryPage = await context.newPage();
  await pageErrorObserver.waitForPage(secondaryPage);
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
    const button = document.createElement('button');
    button.textContent = 'Open error probe popup';
    button.onclick = () => window.open('/browser-error-gate-popup');
    document.body.append(button);
  });
  const popupEvent = page.waitForEvent('popup');
  const ack = waitForContextConsoleAck(page.context(), id);
  await page.getByRole('button', { name: 'Open error probe popup' }).click();
  await popupEvent;
  await ack;
  expectNativeErrorFailure(testInfo, id, 'error');
});

test('an observed secondary-context fault remains a failure on close', async ({
  page,
  newObservedContext,
  pageErrorObserver,
}, testInfo) => {
  await openRoot(page);
  const context = await newObservedContext({ baseURL: new URL(page.url()).origin });
  await context.route('**/browser-error-gate-empty', (route) =>
    route.fulfill({ contentType: 'text/html', body: emptyDocument }),
  );
  const secondaryPage = await context.newPage();
  await pageErrorObserver.waitForPage(secondaryPage);
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
          nonce: 'malformed-field-nonce',
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function stateReadBarrier() {
  const captured = deferred<void>();
  const release = deferred<void>();
  const delivered = deferred<void>();
  const hold = (frame: Frame) => {
    const evaluate = frame.evaluate.bind(frame);
    let first = true;
    frame.evaluate = ((...args: Parameters<Frame['evaluate']>) => {
      const result = evaluate(...args);
      if (!first) return result;
      first = false;
      return result.then(async (state) => {
        captured.resolve();
        await release.promise;
        delivered.resolve();
        return state;
      });
    }) as Frame['evaluate'];
  };
  return {
    hold,
    captured: captured.promise,
    release: () => release.resolve(),
    delivered: delivered.promise,
  };
}

function holdInitialStateRead(context: BrowserContext) {
  const barrier = stateReadBarrier();
  context.on('page', (page) => barrier.hold(page.mainFrame()));
  return barrier;
}

function coverageMessages(observer: ReturnType<typeof createBrowserErrorObserver>) {
  return observer.errors.map(({ kind, message, reason }) => ({ kind, message, reason }));
}

test('an absent installer in an initial terminal document refuses coverage', async ({
  browser,
}) => {
  const observer = createBrowserErrorObserver();
  const context = await browser.newContext();
  context.addInitScript = async () => ({
    dispose: async () => {},
    [Symbol.asyncDispose]: async () => {},
  });
  try {
    await observer.registerContext(context);
    const page = await context.newPage();
    await observer.waitForPage(page);
    await context.close();
    expect(coverageMessages(observer)).toEqual([
      {
        kind: 'coverage-failure',
        message: 'BROWSER_ERROR_OBSERVER_COVERAGE:installer-state-missing',
        reason: undefined,
      },
    ]);
  } finally {
    await observer.dispose();
  }
});

test('a stale state read cannot erase a superseded document failure', async ({ browser }) => {
  const observer = createBrowserErrorObserver();
  const context = await browser.newContext();
  const held = holdInitialStateRead(context);
  try {
    await observer.registerContext(context);
    const page = await context.newPage();
    await held.captured;
    await page.goto('data:text/html,<title>Replacement document</title>');
    await observer.waitForPage(page);
    held.release();
    await held.delivered;
    await observer.assertContextReady(context);
    expect(coverageMessages(observer)).toEqual([
      {
        kind: 'coverage-failure',
        message: 'BROWSER_ERROR_OBSERVER_COVERAGE:document-superseded-before-ready',
        reason: undefined,
      },
    ]);
  } finally {
    held.release();
    await observer.dispose();
  }
});

test('a stale state read cannot revive a closed page', async ({ browser }) => {
  const observer = createBrowserErrorObserver();
  const context = await browser.newContext();
  const held = holdInitialStateRead(context);
  try {
    await observer.registerContext(context);
    const page = await context.newPage();
    await held.captured;
    await page.close();
    held.release();
    await held.delivered;
    await observer.assertContextReady(context);
    expect(coverageMessages(observer)).toEqual([
      {
        kind: 'coverage-failure',
        message: 'BROWSER_ERROR_OBSERVER_COVERAGE:page-closed-before-ready',
        reason: undefined,
      },
    ]);
  } finally {
    held.release();
    await observer.dispose();
  }
});

test('verified documents support same-document navigation and repeated reloads', async ({
  browser,
}) => {
  const observer = createBrowserErrorObserver();
  const context = await browser.newContext();
  try {
    await observer.registerContext(context);
    const page = await context.newPage();
    await observer.waitForPage(page);
    await page.goto('data:text/html,<title>Navigation control</title>');
    await observer.waitForPage(page);
    await page.evaluate(() => {
      location.hash = 'same-document';
    });
    await observer.waitForPage(page);
    await page.reload();
    await observer.waitForPage(page);
    await page.reload();
    await observer.waitForPage(page);
    await observer.assertContextReady(context);
    expect(observer.errors).toEqual([]);
  } finally {
    await observer.dispose();
  }
});

function prependObserverSetup(context: BrowserContext, setup: string) {
  const addInitScript = context.addInitScript.bind(context);
  context.addInitScript = async (script, arg, options) => {
    if (typeof script !== 'function') throw new Error('Expected the observer installer function.');
    return addInitScript(
      {
        content: `const observerConfig = ${JSON.stringify(arg)};
${setup}
(${script.toString()})(observerConfig);`,
      },
      undefined,
      options,
    );
  };
}

for (const scenario of [
  {
    id: 'nonce-generation',
    setup: `crypto.getRandomValues = () => { throw new Error('probe-nonce-generation'); };`,
    records: [
      {
        kind: 'coverage-failure',
        message: 'BROWSER_ERROR_OBSERVER_COVERAGE:installer-failed',
        reason: 'probe-nonce-generation',
      },
    ],
  },
  {
    id: 'pre-console',
    setup: `Object.defineProperty(console, 'debug', { get() { throw new Error('probe-pre-console'); } });`,
    records: [
      {
        kind: 'coverage-failure',
        message: 'BROWSER_ERROR_OBSERVER_COVERAGE:installer-failed',
        reason: 'probe-pre-console',
      },
    ],
  },
  {
    id: 'listener-install',
    setup: `const add = window.addEventListener.bind(window); window.addEventListener = (type, ...args) => { if (type === 'error') throw new Error('probe-listener-install'); return add(type, ...args); };`,
    records: [
      { kind: 'observer-failure', message: 'probe-listener-install', reason: undefined },
      {
        kind: 'coverage-failure',
        message: 'BROWSER_ERROR_OBSERVER_COVERAGE:installer-failed',
        reason: 'probe-listener-install',
      },
    ],
  },
  {
    id: 'ready-emission',
    setup: `const debug = console.debug.bind(console); console.debug = text => { if (text.includes('"kind":"ready"')) throw new Error('probe-ready-emission'); debug(text); };`,
    records: [
      { kind: 'observer-failure', message: 'probe-ready-emission', reason: undefined },
      {
        kind: 'coverage-failure',
        message: 'BROWSER_ERROR_OBSERVER_COVERAGE:installer-failed',
        reason: 'probe-ready-emission',
      },
    ],
  },
  {
    id: 'dropped-ready-with-orphan',
    setup: `const debug = console.debug.bind(console); console.debug = text => { if (!text.includes('"kind":"ready"')) debug(text); }; debug('__capacitylens_browser_error_observer__:' + JSON.stringify({ channel: '__capacitylens_browser_error_observer__', token: observerConfig.token, nonce: 'orphan-positive-ready', kind: 'ready', url: location.href }));`,
    records: [
      {
        kind: 'coverage-failure',
        message: 'BROWSER_ERROR_OBSERVER_COVERAGE:readiness-timeout',
        reason: undefined,
      },
    ],
  },
]) {
  test(`observer setup refuses coverage after ${scenario.id}`, async ({ browser }) => {
    const observer = createBrowserErrorObserver();
    const context = await browser.newContext();
    prependObserverSetup(context, scenario.setup);
    try {
      await observer.registerContext(context);
      const page = await context.newPage();
      await observer.waitForPage(page);
      await context.close();
      expect(coverageMessages(observer)).toEqual(scenario.records);
    } finally {
      await observer.dispose();
    }
  });
}

test('an orphan READY cannot credit a document with a missing installer', async ({ browser }) => {
  const observer = createBrowserErrorObserver();
  const context = await browser.newContext();
  const addInitScript = context.addInitScript.bind(context);
  context.addInitScript = async (_script, arg) => {
    const config = arg as { token: string };
    return addInitScript(({ token }) => {
      console.debug(
        '__capacitylens_browser_error_observer__:' +
          JSON.stringify({
            channel: '__capacitylens_browser_error_observer__',
            token,
            nonce: 'orphan-positive-ready',
            kind: 'ready',
            url: location.href,
          }),
      );
    }, config);
  };
  try {
    await observer.registerContext(context);
    const page = await context.newPage();
    await observer.waitForPage(page);
    await context.close();
    expect(coverageMessages(observer)).toEqual([
      {
        kind: 'coverage-failure',
        message: 'BROWSER_ERROR_OBSERVER_COVERAGE:installer-state-missing',
        reason: undefined,
      },
    ]);
  } finally {
    await observer.dispose();
  }
});

test('a true page-close beforeunload ErrorEvent reaches the browser error gate', async ({
  page,
  pageErrorObserver,
}, testInfo) => {
  await openRoot(page);
  await pageErrorObserver.waitForPage(page);
  const id = 'page-close-beforeunload-error';
  await page.evaluate((expected) => {
    window.addEventListener('beforeunload', () => {
      throw new Error(expected);
    });
  }, sentinel(id));
  const closed = page.waitForEvent('close');
  await page.close({ runBeforeUnload: true });
  await closed;
  expectNativeErrorFailure(testInfo, id, 'error');
});

test('a stale state read cannot revive a detached frame', async ({ browser }) => {
  const observer = createBrowserErrorObserver();
  const context = await browser.newContext();
  const held = stateReadBarrier();
  context.on('page', (page) =>
    page.on('framenavigated', (frame) => {
      if (frame.url() === 'http://frame-control.invalid/detach-target') held.hold(frame);
    }),
  );
  try {
    await observer.registerContext(context);
    const page = await context.newPage();
    await observer.waitForPage(page);
    await context.route('http://frame-control.invalid/detach-target', (route) =>
      route.fulfill({ contentType: 'text/html', body: emptyDocument }),
    );
    await page.evaluate(() => {
      const frame = document.createElement('iframe');
      frame.src = 'http://frame-control.invalid/detach-target';
      document.body.append(frame);
    });
    await held.captured;
    await page.evaluate(() => document.querySelector('iframe')!.remove());
    held.release();
    await held.delivered;
    await observer.assertContextReady(context);
    expect(coverageMessages(observer)).toEqual([
      {
        kind: 'coverage-failure',
        message: 'BROWSER_ERROR_OBSERVER_COVERAGE:frame-detached-before-ready',
        reason: undefined,
      },
    ]);
  } finally {
    held.release();
    await observer.dispose();
  }
});

test('a navigation canceled before commit creates no document expectation', async ({ browser }) => {
  const observer = createBrowserErrorObserver();
  const context = await browser.newContext();
  try {
    await observer.registerContext(context);
    const page = await context.newPage();
    await observer.waitForPage(page);
    await context.route('http://browser-control.invalid/canceled', (route) =>
      route.abort('aborted'),
    );
    await expect(page.goto('http://browser-control.invalid/canceled')).rejects.toThrow();
    await observer.assertContextReady(context);
    expect(observer.errors).toEqual([]);
  } finally {
    await observer.dispose();
  }
});

test('an unidentified attachment read cannot credit the first committed document', async ({
  browser,
}) => {
  const observer = createBrowserErrorObserver();
  const context = await browser.newContext();
  const held = stateReadBarrier();
  context.on('page', (page) => page.on('frameattached', held.hold));
  try {
    await observer.registerContext(context);
    const page = await context.newPage();
    await observer.waitForPage(page);
    await context.route('http://frame-control.invalid/first-target', (route) =>
      route.fulfill({ contentType: 'text/html', body: emptyDocument }),
    );
    await page.evaluate(() => {
      const frame = document.createElement('iframe');
      frame.src = 'http://frame-control.invalid/first-target';
      document.body.append(frame);
    });
    await held.captured;
    await observer.waitForPage(page);
    held.release();
    await held.delivered;
    await observer.assertContextReady(context);
    expect(observer.errors).toEqual([]);
    expect(observer.lifecycleDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'attachment-retired-unverified',
          origin: 'attached',
          retiredUnverified: true,
        }),
        expect.objectContaining({ event: 'stale-read-discarded', origin: 'attached' }),
        expect.objectContaining({
          event: 'verified',
          origin: 'navigation',
          frameUrl: 'http://frame-control.invalid/first-target',
        }),
      ]),
    );
  } finally {
    held.release();
    await observer.dispose();
  }
});

test('the first committed child document must contain its own installer', async ({ browser }) => {
  const observer = createBrowserErrorObserver();
  const context = await browser.newContext();
  const addInitScript = context.addInitScript.bind(context);
  context.addInitScript = async (script, arg) => {
    if (typeof script !== 'function') throw new Error('Expected the observer installer function.');
    return addInitScript({
      content: `if (location.pathname !== '/missing-target') { (${script.toString()})(${JSON.stringify(arg)}); }`,
    });
  };
  try {
    await observer.registerContext(context);
    const page = await context.newPage();
    await observer.waitForPage(page);
    await context.route('http://frame-control.invalid/missing-target', (route) =>
      route.fulfill({ contentType: 'text/html', body: emptyDocument }),
    );
    const committed = page.waitForEvent(
      'framenavigated',
      (frame) => frame.url() === 'http://frame-control.invalid/missing-target',
    );
    await page.evaluate(() => {
      const frame = document.createElement('iframe');
      frame.src = 'http://frame-control.invalid/missing-target';
      document.body.append(frame);
    });
    await committed;
    await observer.waitForPage(page);
    await context.close();
    expect(coverageMessages(observer)).toEqual([
      {
        kind: 'coverage-failure',
        message: 'BROWSER_ERROR_OBSERVER_COVERAGE:installer-state-missing',
        reason: undefined,
      },
    ]);
  } finally {
    await observer.dispose();
  }
});

test('an identified attachment waiting for READY retains its superseded failure', async ({
  browser,
}, testInfo) => {
  const observer = createBrowserErrorObserver();
  const context = await browser.newContext();
  const target = 'http://frame-control.invalid/identified-target';
  const navigationCaptured = deferred<void>();
  const targetReadyCaptured = deferred<void>();
  const readFinished = deferred<void>();
  const pendingNavigations: Array<{ url: string; deliver: () => void }> = [];
  const pendingReady: Array<{ url: string; nonce: string; deliver: () => void }> = [];
  const deliveryTrace: Array<{ event: string; url: string; nonce?: string }> = [];
  let bufferChildReady = false;
  context.on('page', (page) => {
    const listen = page.on.bind(page) as unknown as (
      event: string,
      listener: (...args: unknown[]) => void,
    ) => Page;
    page.on = ((event: string, listener: (...args: unknown[]) => void) => {
      if (event !== 'framenavigated') return listen(event, listener);
      return listen(event, (value) => {
        const frame = value as Frame;
        if (frame === page.mainFrame()) {
          listener(frame);
          return;
        }
        const url = frame.url();
        deliveryTrace.push({ event: 'navigation-buffered', url });
        pendingNavigations.push({ url, deliver: () => listener(frame) });
        if (url === target) navigationCaptured.resolve();
      });
    }) as Page['on'];
    page.on('frameattached', (frame) => {
      const evaluate = frame.evaluate.bind(frame);
      frame.evaluate = (async (...args: Parameters<Frame['evaluate']>) => {
        await navigationCaptured.promise;
        const state = await evaluate(...args);
        readFinished.resolve();
        return state;
      }) as Frame['evaluate'];
    });
  });
  const listen = context.on.bind(context) as unknown as (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => BrowserContext;
  context.on = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event !== 'console') return listen(event, listener);
    return listen(event, (value) => {
      const message = value as ConsoleMessage;
      const text = message.text();
      if (bufferChildReady && text.startsWith(observerMessagePrefix)) {
        const envelope = JSON.parse(text.slice(observerMessagePrefix.length)) as {
          kind: string;
          url: string;
          nonce: string;
        };
        if (envelope.kind === 'ready') {
          deliveryTrace.push({ event: 'ready-buffered', url: envelope.url, nonce: envelope.nonce });
          pendingReady.push({
            url: envelope.url,
            nonce: envelope.nonce,
            deliver: () => listener(message),
          });
          if (envelope.url === target) targetReadyCaptured.resolve();
          return;
        }
      }
      listener(message);
    });
  }) as BrowserContext['on'];
  try {
    await observer.registerContext(context);
    const page = await context.newPage();
    await observer.waitForPage(page);
    await context.route(target, (route) =>
      route.fulfill({ contentType: 'text/html', body: emptyDocument }),
    );
    bufferChildReady = true;
    await page.evaluate((src) => {
      const frame = document.createElement('iframe');
      frame.src = src;
      document.body.append(frame);
    }, target);
    await Promise.all([
      navigationCaptured.promise,
      targetReadyCaptured.promise,
      readFinished.promise,
    ]);
    await page.evaluate(() => true);
    const targetReadyIndex = pendingReady.findIndex((entry) => entry.url === target);
    expect(targetReadyIndex).toBeGreaterThanOrEqual(0);
    const targetReady = pendingReady[targetReadyIndex]!;
    const accepted = observer.lifecycleDiagnostics.find(
      (entry) =>
        entry.event === 'state-read-accepted' &&
        entry.origin === 'attached' &&
        entry.observedNonce === targetReady.nonce,
    );
    expect(accepted).toMatchObject({ observedStatus: 'ready' });
    expect(
      observer.lifecycleDiagnostics.filter(
        (entry) => entry.event === 'verified' && entry.generation === accepted!.generation,
      ),
    ).toEqual([]);
    expect(observer.errors).toEqual([]);
    const firstNavigation = pendingNavigations.shift();
    expect(firstNavigation).toBeDefined();
    deliveryTrace.push({ event: 'navigation-delivered', url: firstNavigation!.url });
    firstNavigation!.deliver();
    expect(coverageMessages(observer)).toEqual([
      {
        kind: 'coverage-failure',
        message: 'BROWSER_ERROR_OBSERVER_COVERAGE:document-superseded-before-ready',
        reason: undefined,
      },
    ]);
    pendingReady.splice(targetReadyIndex, 1);
    deliveryTrace.push({
      event: 'ready-delivered',
      url: targetReady.url,
      nonce: targetReady.nonce,
    });
    targetReady.deliver();
    await observer.waitForPage(page);
    while (pendingNavigations.length) {
      const navigation = pendingNavigations.shift()!;
      deliveryTrace.push({ event: 'navigation-delivered', url: navigation.url });
      navigation.deliver();
      await observer.waitForPage(page);
    }
    for (const ready of pendingReady.splice(0)) ready.deliver();
    await observer.assertContextReady(context);
    expect(coverageMessages(observer)).toEqual([
      {
        kind: 'coverage-failure',
        message: 'BROWSER_ERROR_OBSERVER_COVERAGE:document-superseded-before-ready',
        reason: undefined,
      },
    ]);
  } finally {
    for (const ready of pendingReady.splice(0)) ready.deliver();
    for (const navigation of pendingNavigations.splice(0)) navigation.deliver();
    await observer.dispose();
    await testInfo.attach('identified-attachment-delivery-trace', {
      body: Buffer.from(
        JSON.stringify({ deliveryTrace, lifecycle: observer.lifecycleDiagnostics }, null, 2),
      ),
      contentType: 'application/json',
    });
  }
});

test('a pending committed document retains its failure after another commit', async ({
  browser,
}, testInfo) => {
  const observer = createBrowserErrorObserver();
  const context = await browser.newContext();
  const held = stateReadBarrier();
  context.on('page', (page) =>
    page.on('framenavigated', (frame) => {
      if (frame.url() === 'http://frame-control.invalid/committed-a') held.hold(frame);
    }),
  );
  try {
    await observer.registerContext(context);
    const page = await context.newPage();
    await observer.waitForPage(page);
    await context.route('http://frame-control.invalid/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: emptyDocument }),
    );
    await page.goto('http://frame-control.invalid/committed-a');
    await held.captured;
    await page.goto('http://frame-control.invalid/committed-b');
    await observer.waitForPage(page);
    held.release();
    await held.delivered;
    await observer.assertContextReady(context);
    expect(coverageMessages(observer)).toEqual([
      {
        kind: 'coverage-failure',
        message: 'BROWSER_ERROR_OBSERVER_COVERAGE:document-superseded-before-ready',
        reason: undefined,
      },
    ]);
    expect(observer.lifecycleDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'stale-read-discarded',
          origin: 'navigation',
          observedStatus: 'ready',
        }),
      ]),
    );
    const failure = observer.lifecycleDiagnostics.find(
      (entry) => entry.event === 'coverage-failure',
    );
    expect(failure).toMatchObject({
      origin: 'navigation',
      reason: 'document-superseded-before-ready',
    });
    expect(observer.lifecycleDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'epoch-started',
          generation: failure!.generation,
          frameUrl: 'http://frame-control.invalid/committed-a',
        }),
      ]),
    );
    await testInfo.attach('committed-replacement-lifecycle', {
      body: Buffer.from(JSON.stringify(observer.lifecycleDiagnostics, null, 2)),
      contentType: 'application/json',
    });
  } finally {
    held.release();
    await observer.dispose();
  }
});
