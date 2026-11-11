import { randomUUID } from 'node:crypto';
import { expect, test as base } from '@playwright/test';
import type {
  APIRequestContext,
  BrowserContext,
  BrowserContextOptions,
  ConsoleMessage,
  Locator,
  Page,
} from '@playwright/test';
import { clearAuthE2ECompanies, waitForAuthE2EBaseline } from './authTestSupport';

export { expect, type APIRequestContext, type Locator, type Page };

type BrowserErrorObserver = {
  registerContext: (context: BrowserContext) => Promise<void>;
  observePage: (page: Page) => void;
};
type CapacityLensFixtures = {
  authCompanyIsolation: void;
  newObservedContext: (options?: BrowserContextOptions) => Promise<BrowserContext>;
  pageErrorObserver: BrowserErrorObserver;
};

const observerPrefix = '__capacitylens_browser_error_observer__:';

type ObserverMessage = {
  channel: string;
  token: string;
  kind: 'ready' | 'error' | 'observer-failure';
  eventType?: string;
  name?: string;
  message?: string;
  reason?: string;
  eventMessage?: string;
  stack?: string;
  url?: string;
  filename?: string;
  line?: number;
  column?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function observerMessageIssue(value: unknown): string | undefined {
  if (value === null) return 'expected an object envelope, received null';
  if (Array.isArray(value)) return 'expected an object envelope, received an array';
  if (!isRecord(value)) return `expected an object envelope, received ${typeof value}`;
  if (typeof value.channel !== 'string') return 'channel must be a string';
  if (typeof value.token !== 'string') return 'token must be a string';
  if (value.kind !== 'ready' && value.kind !== 'error' && value.kind !== 'observer-failure') {
    return 'kind must be ready, error, or observer-failure';
  }
  if (value.kind === 'ready') {
    return typeof value.url === 'string' ? undefined : 'ready url must be a string';
  }
  if (value.kind === 'observer-failure') {
    return typeof value.message === 'string'
      ? undefined
      : 'observer-failure message must be a string';
  }
  if (value.eventType !== 'error' && value.eventType !== 'unhandledrejection') {
    return 'eventType must be error or unhandledrejection';
  }
  if (typeof value.name !== 'string') return 'name must be a string';
  if (typeof value.message !== 'string') return 'message must be a string';
  if (typeof value.url !== 'string') return 'url must be a string';
  if (value.eventMessage !== undefined && typeof value.eventMessage !== 'string') {
    return 'eventMessage must be a string when present';
  }
  if (value.stack !== undefined && typeof value.stack !== 'string') {
    return 'stack must be a string when present';
  }
  if (value.filename !== undefined && typeof value.filename !== 'string') {
    return 'filename must be a string when present';
  }
  if (value.line !== undefined && typeof value.line !== 'number') {
    return 'line must be a number when present';
  }
  if (value.column !== undefined && typeof value.column !== 'number') {
    return 'column must be a number when present';
  }
  return undefined;
}

function installBrowserErrorObserver(token: string) {
  const nativeDebug = console.debug.bind(console);
  const channel = '__capacitylens_browser_error_observer__';

  const safeString = (value: unknown) => {
    try {
      if (typeof value === 'string') return value;
      if (value instanceof Error) return value.message;
      return String(value);
    } catch {
      return '<unprintable>';
    }
  };
  const readString = (value: object, key: 'name' | 'message' | 'stack') => {
    try {
      const property = (value as Record<string, unknown>)[key];
      return property === undefined || property === null ? undefined : safeString(property);
    } catch {
      return '<unreadable>';
    }
  };
  const errorDetails = (value: unknown) => {
    const isObject = (typeof value === 'object' && value !== null) || typeof value === 'function';
    const details = isObject ? (value as object) : undefined;
    const name = details ? readString(details, 'name') : undefined;
    const message = details ? readString(details, 'message') : undefined;
    const stack = details ? readString(details, 'stack') : undefined;
    return {
      name: name ?? (value instanceof Error ? 'Error' : typeof value),
      message: message ?? safeString(value),
      ...(stack ? { stack } : {}),
    };
  };
  const emit = (kind: ObserverMessage['kind'], fields: Partial<ObserverMessage> = {}) => {
    nativeDebug(`${channel}:${JSON.stringify({ channel, token, kind, ...fields })}`);
  };
  const reportFailure = (error: unknown) => {
    try {
      emit('observer-failure', errorDetails(error));
    } catch {
      // A failed console transport cannot be reported over that same transport.
    }
  };
  const onError = (event: Event) => {
    if (!(event instanceof ErrorEvent)) return;
    try {
      const details = errorDetails(event.error);
      emit('error', {
        eventType: 'error',
        ...details,
        message: details.message || event.message,
        eventMessage: event.message,
        url: window.location.href,
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    } catch (error) {
      reportFailure(error);
    }
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    try {
      emit('error', {
        eventType: 'unhandledrejection',
        ...errorDetails(event.reason),
        url: window.location.href,
      });
    } catch (error) {
      reportFailure(error);
    }
  };

  window.addEventListener('error', onError, true);
  window.addEventListener('unhandledrejection', onUnhandledRejection, true);
  try {
    emit('ready', { url: window.location.href });
  } catch (error) {
    reportFailure(error);
  }
}

function formatObserverMessage(message: ObserverMessage) {
  const detail = [
    `BROWSER_ERROR_OBSERVER_SENTINEL:${message.eventType ?? message.kind}`,
    message.message ? `message=${message.message}` : undefined,
    message.reason ? `reason=${message.reason}` : undefined,
    message.eventMessage ? `eventMessage=${message.eventMessage}` : undefined,
    message.name ? `name=${message.name}` : undefined,
    message.url ? `url=${message.url}` : undefined,
    message.filename ? `filename=${message.filename}` : undefined,
    message.line !== undefined ? `line=${message.line}` : undefined,
    message.column !== undefined ? `column=${message.column}` : undefined,
    message.stack ? `stack=${message.stack}` : undefined,
  ].filter(Boolean);
  return new Error(detail.join('\n'));
}

function consumeObserverMessage(
  consoleMessage: ConsoleMessage,
  token: string,
  recordError: (message: ObserverMessage) => void,
) {
  if (consoleMessage.type() !== 'debug') return;
  const text = consoleMessage.text();
  if (!text.startsWith(observerPrefix)) return;

  let value: unknown;
  const envelope = text.slice(observerPrefix.length);
  try {
    value = JSON.parse(envelope) as unknown;
  } catch (error) {
    recordError({
      channel: observerPrefix.slice(0, -1),
      token,
      kind: 'observer-failure',
      message: `BROWSER_ERROR_OBSERVER_ENVELOPE_SENTINEL:${envelope}: ${String(error)}`,
    });
    return;
  }
  const issue = observerMessageIssue(value);
  if (issue) {
    const message =
      isRecord(value) && typeof value.message === 'string'
        ? value.message
        : `BROWSER_ERROR_OBSERVER_ENVELOPE_SENTINEL:${envelope}`;
    recordError({
      channel: observerPrefix.slice(0, -1),
      token,
      kind: 'observer-failure',
      message,
      reason: issue,
    });
    return;
  }
  const message = value as ObserverMessage;
  if (message.channel !== observerPrefix.slice(0, -1) || message.token !== token) return;
  if (message.kind === 'ready') return;
  if (message.kind === 'error' || message.kind === 'observer-failure') {
    recordError(message);
    return;
  }
}

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
      const errors: ObserverMessage[] = [];
      const driverPageErrors: Error[] = [];
      const pageErrorListeners = new Map<Page, (error: Error) => void>();
      const contextListeners = new Map<BrowserContext, (message: ConsoleMessage) => void>();
      const recordError = (message: ObserverMessage) => errors.push(message);
      const observePage = (page: Page) => {
        if (pageErrorListeners.has(page)) return;
        const listener = (error: Error) => driverPageErrors.push(error);
        pageErrorListeners.set(page, listener);
        page.on('pageerror', listener);
      };
      const registerContext = async (context: BrowserContext) => {
        if (contextListeners.has(context)) return;
        const token = randomUUID();
        const listener = (message: ConsoleMessage) =>
          consumeObserverMessage(message, token, recordError);
        contextListeners.set(context, listener);
        context.on('console', listener);
        await context.addInitScript(installBrowserErrorObserver, token);
      };
      try {
        await use({ observePage, registerContext });
      } finally {
        contextListeners.forEach((listener, context) => context.off('console', listener));
        pageErrorListeners.forEach((listener, page) => page.off('pageerror', listener));
      }
      if (errors.length > 0) {
        if (testInfo.annotations.some((annotation) => annotation.type === 'browser-error-probe')) {
          testInfo.annotations.push({
            type: 'browser-error-observer-records',
            description: JSON.stringify(errors),
          });
        }
        const details = errors.map((message, index) => {
          const error = formatObserverMessage(message);
          return `${index + 1}. ${error.stack ?? error.message}`;
        });
        if (driverPageErrors.length > 0) {
          details.push(
            `Playwright pageerror diagnostics:\n${driverPageErrors
              .map((error) => error.stack ?? error.message)
              .join('\n\n')}`,
          );
        }
        throw new Error(
          `Uncaught browser error event${errors.length === 1 ? '' : 's'}:\n\n${details.join('\n\n')}`,
        );
      }
    },
    { auto: true },
  ],
  context: async ({ context, pageErrorObserver }, use) => {
    const observePage = pageErrorObserver.observePage;
    await pageErrorObserver.registerContext(context);
    context.pages().forEach(observePage);
    context.on('page', observePage);
    try {
      await use(context);
    } finally {
      context.off('page', observePage);
    }
  },
  newObservedContext: async ({ browser, pageErrorObserver }, use) => {
    const contexts = new Set<BrowserContext>();
    const listeners = new Map<BrowserContext, (page: Page) => void>();
    try {
      await use(async (options) => {
        const context = await browser.newContext(options);
        contexts.add(context);
        const observePage = pageErrorObserver.observePage;
        listeners.set(context, observePage);
        await pageErrorObserver.registerContext(context);
        context.pages().forEach(observePage);
        context.on('page', observePage);
        return context;
      });
    } finally {
      await Promise.all(
        [...contexts].map(async (context) => {
          context.off('page', listeners.get(context)!);
          await context.close();
        }),
      );
    }
  },
});
