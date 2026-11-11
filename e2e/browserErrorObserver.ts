import { randomUUID } from 'node:crypto';
import type { BrowserContext, ConsoleMessage, Frame, Page } from '@playwright/test';

const observerPrefix = '__capacitylens_browser_error_observer__:';

type ObserverMessage = {
  channel: string;
  token: string;
  kind: 'ready' | 'error' | 'observer-failure' | 'coverage-failure';
  eventType?: string;
  nonce?: string;
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
  if (typeof value.nonce !== 'string') return 'nonce must be a string';
  if (
    value.kind !== 'ready' &&
    value.kind !== 'error' &&
    value.kind !== 'observer-failure' &&
    value.kind !== 'coverage-failure'
  ) {
    return 'kind must be ready, error, observer-failure, or coverage-failure';
  }
  if (value.kind === 'coverage-failure')
    return typeof value.message === 'string'
      ? undefined
      : 'coverage-failure message must be a string';
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

type BrowserObserverState = {
  token: string;
  nonce: string;
  status: 'installing' | 'ready' | 'failed';
  failure?: { name: string; message: string; stack?: string };
};

function installBrowserErrorObserver(config: { token: string; stateKey: string }) {
  const { token, stateKey } = config;
  const channel = '__capacitylens_browser_error_observer__';
  const globals = window as unknown as Record<string, unknown>;
  const state: BrowserObserverState = {
    token,
    nonce: '',
    status: 'installing',
  };

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
  let nativeDebug: typeof console.debug | undefined;
  const emit = (kind: ObserverMessage['kind'], fields: Partial<ObserverMessage> = {}) => {
    if (!nativeDebug) throw new Error('Observer console transport is unavailable.');
    nativeDebug(
      `${channel}:${JSON.stringify({ channel, token, nonce: state.nonce, kind, ...fields })}`,
    );
  };
  const reportFailure = (error: unknown) => {
    state.status = 'failed';
    state.failure = errorDetails(error);
    try {
      emit('observer-failure', state.failure);
    } catch {
      // A failed console transport cannot report over that same transport.
    }
  };
  try {
    const existing = globals[stateKey] as BrowserObserverState | undefined;
    if (existing?.token === token) return existing;
    Object.defineProperty(window, stateKey, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: state,
    });
    state.nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    nativeDebug = console.debug.bind(console);
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
    emit('ready', { url: window.location.href });
    state.status = 'ready';
  } catch (error) {
    reportFailure(error);
  }
  return state;
}

export function formatObserverMessage(message: ObserverMessage) {
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
  recordReady: (message: ObserverMessage, page: Page) => void,
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
  if (message.kind === 'ready') {
    const page = consoleMessage.page();
    if (page) recordReady(message, page);
    else
      recordError({
        ...message,
        kind: 'coverage-failure',
        message: 'BROWSER_ERROR_OBSERVER_COVERAGE:ready-page-unavailable',
      });
    return;
  }
  if (
    message.kind === 'error' ||
    message.kind === 'observer-failure' ||
    message.kind === 'coverage-failure'
  ) {
    recordError(message);
    return;
  }
}

type FrameEpoch = {
  generation: number;
  origin: 'attached' | 'existing' | 'navigation';
  retiredUnverified: boolean;
  baselineNonce?: string;
  nonce?: string;
  state?: BrowserObserverState;
  verified: boolean;
  settled: boolean;
  completion: Promise<void>;
  finish: () => void;
  timer: ReturnType<typeof setTimeout>;
};
type ObservedFrame = {
  frame: Frame;
  page: Page;
  terminal: boolean;
  observedNavigation: boolean;
  lastVerifiedNonce?: string;
  pending: Set<FrameEpoch>;
  epoch?: FrameEpoch;
};
type LifecycleDiagnostic = {
  event: string;
  token?: string;
  generation?: number;
  origin?: FrameEpoch['origin'];
  nonce?: string;
  frameUrl?: string;
  observedNonce?: string;
  observedStatus?: string;
  readyUrl?: string;
  reason?: string;
  retiredUnverified?: boolean;
};
type ContextState = {
  token: string;
  stateKey: string;
  terminal: boolean;
  ready: Map<Page, Set<string>>;
  consoleListener: (message: ConsoleMessage) => void;
  pageListener: (page: Page) => void;
  closeListener: () => void;
};
type PageListeners = {
  frameAttached: (frame: Frame) => void;
  frameNavigated: (frame: Frame) => void;
  frameDetached: (frame: Frame) => void;
  close: () => void;
  pageError: (error: Error) => void;
};

/**
 * Observes navigation epochs and surviving initial documents independently of READY transport.
 * An unidentified child attachment retired at first commit remains unverified: executable
 * transient initial blank content can escape coverage before its identity is observable.
 */
export function createBrowserErrorObserver() {
  const errors: ObserverMessage[] = [];
  const driverPageErrors: Error[] = [];
  const lifecycleDiagnostics: LifecycleDiagnostic[] = [];
  const contexts = new Map<BrowserContext, ContextState>();
  const pages = new Map<Page, PageListeners>();
  const frames = new Map<Frame, ObservedFrame>();
  let generation = 0;
  const recordError = (message: ObserverMessage) => errors.push(message);
  const diagnose = (
    record: ObservedFrame,
    epoch: FrameEpoch,
    event: string,
    fields: Partial<LifecycleDiagnostic> = {},
  ) => {
    const token = contexts.get(record.page.context())?.token;
    lifecycleDiagnostics.push({
      event,
      ...(token ? { token } : {}),
      generation: epoch.generation,
      origin: epoch.origin,
      ...(epoch.nonce ? { nonce: epoch.nonce } : {}),
      retiredUnverified: epoch.retiredUnverified,
      frameUrl: record.frame.url(),
      ...fields,
    });
  };
  const settle = (epoch: FrameEpoch) => {
    if (epoch.settled) return;
    epoch.settled = true;
    clearTimeout(epoch.timer);
    epoch.finish();
  };
  const coverage = (state: ContextState, epoch: FrameEpoch, code: string, reason?: string) => {
    epoch.verified = false;
    lifecycleDiagnostics.push({
      event: 'coverage-failure',
      token: state.token,
      generation: epoch.generation,
      origin: epoch.origin,
      ...(epoch.nonce ? { nonce: epoch.nonce } : {}),
      reason: code,
    });
    recordError({
      channel: observerPrefix.slice(0, -1),
      token: state.token,
      nonce: epoch.nonce ?? `generation:${epoch.generation}`,
      kind: 'coverage-failure',
      message: `BROWSER_ERROR_OBSERVER_COVERAGE:${code}`,
      ...(reason ? { reason } : {}),
    });
    settle(epoch);
  };
  const isCurrent = (record: ObservedFrame, epoch: FrameEpoch, state: ContextState) =>
    !record.terminal && !state.terminal && record.epoch === epoch;
  const verify = (record: ObservedFrame, epoch: FrameEpoch, state: ContextState) => {
    if (!isCurrent(record, epoch, state) || epoch.settled) return;
    if (
      epoch.state?.status === 'ready' &&
      epoch.nonce &&
      state.ready.get(record.page)?.has(epoch.nonce)
    ) {
      epoch.verified = true;
      record.lastVerifiedNonce = epoch.nonce;
      diagnose(record, epoch, 'verified');
      settle(epoch);
    }
  };
  const readState = (frame: Frame, stateKey: string) =>
    frame.evaluate(
      (key) =>
        (window as unknown as Record<string, unknown>)[key] as BrowserObserverState | undefined,
      stateKey,
    );
  const acceptState = (
    record: ObservedFrame,
    epoch: FrameEpoch,
    state: ContextState,
    current: BrowserObserverState | undefined,
  ) => {
    if (!isCurrent(record, epoch, state) || epoch.settled) {
      if (
        !record.terminal &&
        !state.terminal &&
        !epoch.settled &&
        epoch.baselineNonce &&
        current?.token === state.token &&
        current.status === 'ready' &&
        current.nonce === epoch.baselineNonce
      ) {
        epoch.verified = true;
        epoch.nonce = current.nonce;
        diagnose(record, epoch, 'repeated-document-verified');
        settle(epoch);
        return;
      }
      if (!epoch.settled) coverage(state, epoch, 'document-superseded-before-ready');
      diagnose(record, epoch, 'stale-read-discarded', {
        ...(current?.nonce ? { observedNonce: current.nonce } : {}),
        ...(current?.status ? { observedStatus: current.status } : {}),
      });
      return;
    }
    diagnose(record, epoch, 'state-read-accepted', {
      ...(current?.nonce ? { observedNonce: current.nonce } : {}),
      ...(current?.status ? { observedStatus: current.status } : {}),
    });
    if (!current) {
      coverage(state, epoch, 'installer-state-missing');
      return;
    }
    if (
      current.token !== state.token ||
      typeof current.nonce !== 'string' ||
      !['installing', 'ready', 'failed'].includes(current.status)
    ) {
      coverage(state, epoch, 'installer-state-invalid');
      return;
    }
    if (current.nonce) epoch.nonce = current.nonce;
    epoch.state = current;
    if (current.status === 'failed') {
      coverage(state, epoch, 'installer-failed', current.failure?.message);
      return;
    }
    if (!current.nonce) {
      coverage(state, epoch, 'installer-state-invalid');
      return;
    }
    verify(record, epoch, state);
  };
  const startEpoch = (
    frame: Frame,
    record: ObservedFrame,
    state: ContextState,
    origin: FrameEpoch['origin'],
  ) => {
    if (record.terminal || state.terminal) return;
    const previous = record.epoch;
    if (
      previous &&
      !previous.settled &&
      (!previous.baselineNonce || (previous.nonce && previous.nonce !== previous.baselineNonce))
    )
      coverage(state, previous, 'document-superseded-before-ready');
    let finish!: () => void;
    const completion = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const epoch: FrameEpoch = {
      generation: ++generation,
      origin,
      retiredUnverified: false,
      ...(record.lastVerifiedNonce ? { baselineNonce: record.lastVerifiedNonce } : {}),
      verified: false,
      settled: false,
      completion,
      finish,
      timer: setTimeout(() => {
        if (!epoch.settled) coverage(state, epoch, 'readiness-timeout');
      }, 5000),
    };
    // Publish the new generation before starting any asynchronous state read.
    record.epoch = epoch;
    record.pending.add(epoch);
    void completion.then(() => record.pending.delete(epoch));
    diagnose(record, epoch, 'epoch-started');
    void readState(frame, state.stateKey).then(
      (current) => acceptState(record, epoch, state, current),
      (error: unknown) => {
        if (!epoch.settled) coverage(state, epoch, 'installer-state-read-failed', String(error));
      },
    );
  };
  const terminate = (record: ObservedFrame, state: ContextState, code: string) => {
    record.terminal = true;
    if (record.epoch) diagnose(record, record.epoch, 'terminal', { reason: code });
    for (const epoch of record.pending) {
      if (!epoch.settled) coverage(state, epoch, code);
    }
  };
  const observePage = (page: Page) => {
    if (pages.has(page)) return;
    const state = contexts.get(page.context());
    if (!state || state.terminal) return;
    const seedFrame = (frame: Frame, origin: FrameEpoch['origin']) => {
      let record = frames.get(frame);
      if (!record) {
        record = { frame, page, terminal: false, observedNavigation: false, pending: new Set() };
        frames.set(frame, record);
        startEpoch(frame, record, state, origin);
      }
      return record;
    };
    const frameAttached = (frame: Frame) => {
      seedFrame(frame, 'attached');
    };
    const frameNavigated = (frame: Frame) => {
      const record = frames.get(frame);
      if (record) {
        if (record.terminal || state.terminal) return;
        const previous = record.epoch;
        // The first child commit can arrive before the attachment's initial document is identifiable.
        // Retiring that unidentified attachment does not verify executable transient blank content.
        if (
          !record.observedNavigation &&
          previous?.origin === 'attached' &&
          !previous.settled &&
          !previous.nonce &&
          !previous.state
        ) {
          previous.retiredUnverified = true;
          diagnose(record, previous, 'attachment-retired-unverified');
          settle(previous);
        }
        record.observedNavigation = true;
        startEpoch(frame, record, state, 'navigation');
      } else {
        const seeded = seedFrame(frame, 'navigation');
        seeded.observedNavigation = true;
      }
    };
    const frameDetached = (frame: Frame) => {
      const record = frames.get(frame);
      if (record) terminate(record, state, 'frame-detached-before-ready');
    };
    const close = () => {
      for (const record of frames.values()) {
        if (record.page === page) terminate(record, state, 'page-closed-before-ready');
      }
    };
    const pageError = (error: Error) => {
      driverPageErrors.push(error);
    };
    pages.set(page, { frameAttached, frameNavigated, frameDetached, close, pageError });
    page.on('frameattached', frameAttached);
    page.on('framenavigated', frameNavigated);
    page.on('framedetached', frameDetached);
    page.on('close', close);
    page.on('pageerror', pageError);
    // Seed existing documents exactly once, including a non-navigating initial document.
    for (const frame of page.frames()) seedFrame(frame, 'existing');
    if (page.isClosed()) close();
  };
  const handleReady = (state: ContextState, message: ObserverMessage, page: Page) => {
    if (!message.nonce || state.terminal) return;
    lifecycleDiagnostics.push({
      event: 'ready-cached',
      token: state.token,
      nonce: message.nonce,
      ...(message.url ? { readyUrl: message.url } : {}),
    });
    let nonces = state.ready.get(page);
    if (!nonces) {
      nonces = new Set();
      state.ready.set(page, nonces);
    }
    nonces.add(message.nonce);
    // READY is passive evidence. An orphan never creates or credits an expectation.
    for (const record of frames.values()) {
      const epoch = record.epoch;
      if (record.page === page && epoch?.nonce === message.nonce) verify(record, epoch, state);
    }
  };
  const waitForPage = async (page: Page) => {
    if (!contexts.has(page.context()))
      throw new Error('Browser error observer context is not registered.');
    observePage(page);
    await Promise.all(
      [...frames.values()]
        .filter((record) => record.page === page)
        .map((record) => record.epoch?.completion),
    );
  };
  const assertContextReady = async (context: BrowserContext) => {
    const state = contexts.get(context);
    if (!state || state.terminal) return;
    for (const [frame, record] of frames) {
      if (record.page.context() !== context || record.terminal || !record.epoch) continue;
      const epoch = record.epoch;
      await Promise.all([...record.pending].map((pending) => pending.completion));
      if (!isCurrent(record, epoch, state) || !epoch.verified) continue;
      let timeout!: ReturnType<typeof setTimeout>;
      const expired = Symbol('expired');
      const current = await Promise.race([
        readState(frame, state.stateKey).catch((error: unknown) => ({ error })),
        new Promise<typeof expired>((resolve) => {
          timeout = setTimeout(() => resolve(expired), 5000);
        }),
      ]);
      clearTimeout(timeout);
      if (!isCurrent(record, epoch, state)) continue;
      if (
        current === expired ||
        !current ||
        'error' in current ||
        current.token !== state.token ||
        current.nonce !== epoch.nonce ||
        current.status !== 'ready'
      ) {
        coverage(state, epoch, 'surviving-frame-state-mismatch');
      }
    }
  };
  const registerContext = async (context: BrowserContext) => {
    if (contexts.has(context)) return;
    const token = randomUUID();
    const stateKey = `__capacitylens_browser_error_observer_state_${token}`;
    const state: ContextState = {
      token,
      stateKey,
      terminal: false,
      ready: new Map(),
      consoleListener: (message) =>
        consumeObserverMessage(message, token, recordError, (ready, page) =>
          handleReady(state, ready, page),
        ),
      pageListener: observePage,
      closeListener: () => {
        state.terminal = true;
        for (const record of frames.values()) {
          if (record.page.context() === context)
            terminate(record, state, 'context-closed-before-ready');
        }
      },
    };
    contexts.set(context, state);
    context.on('console', state.consoleListener);
    context.on('page', state.pageListener);
    context.on('close', state.closeListener);
    for (const page of context.pages()) observePage(page);
    try {
      await context.addInitScript(installBrowserErrorObserver, { token, stateKey });
    } catch (error) {
      recordError({
        channel: observerPrefix.slice(0, -1),
        token,
        nonce: `context:${token}`,
        kind: 'coverage-failure',
        message: 'BROWSER_ERROR_OBSERVER_COVERAGE:init-script-install-rejected',
        reason: String(error),
      });
      throw error;
    }
    await Promise.all(context.pages().map(waitForPage));
  };
  const dispose = async () => {
    for (const context of contexts.keys()) await assertContextReady(context);
    // Keep fault transport attached until the actual browser context has closed.
    await Promise.all(
      [...contexts].filter(([, state]) => !state.terminal).map(([context]) => context.close()),
    );
    for (const [context, state] of contexts) {
      context.off('console', state.consoleListener);
      context.off('page', state.pageListener);
      context.off('close', state.closeListener);
    }
    for (const [page, listeners] of pages) {
      page.off('frameattached', listeners.frameAttached);
      page.off('framenavigated', listeners.frameNavigated);
      page.off('framedetached', listeners.frameDetached);
      page.off('close', listeners.close);
      page.off('pageerror', listeners.pageError);
    }
  };
  return {
    errors,
    driverPageErrors,
    lifecycleDiagnostics,
    registerContext,
    observePage,
    waitForPage,
    assertContextReady,
    dispose,
  };
}
