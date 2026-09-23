import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();
  get length(): number {
    return this.#values.size;
  }
  clear(): void {
    this.#values.clear();
  }
  getItem(key: string): string | null {
    return this.#values.get(String(key)) ?? null;
  }
  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.#values.delete(String(key));
  }
  setItem(key: string, value: string): void {
    this.#values.set(String(key), String(value));
  }
}

// Node >=25 exposes an experimental global localStorage accessor that resolves to undefined unless
// the process receives --localstorage-file, and under a jsdom opaque origin `window.localStorage`
// itself comes through as undefined — so the value captured here must never be trusted blindly.
function readBrowserStorage(getter: () => Storage): Storage | undefined {
  try {
    return getter();
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError") return undefined;
    throw error;
  }
}

// Node 26 can expose Storage globals whose instances do not share Storage.prototype with jsdom.
// Use independent memory stores in that case so prototype spies observe both browser boundaries.
const storagePrototype = typeof Storage === "function" ? Storage.prototype : undefined;
const candidateLocalStorage = typeof window === "undefined" ? undefined : readBrowserStorage(() => window.localStorage);
const candidateSessionStorage =
  typeof window === "undefined" ? undefined : readBrowserStorage(() => window.sessionStorage);
const useMemoryStorage = [candidateLocalStorage, candidateSessionStorage].some(
  (candidate) =>
    !candidate || typeof candidate.getItem !== "function" || Object.getPrototypeOf(candidate) !== storagePrototype,
);
if (useMemoryStorage) {
  const memoryStorageDescriptor = { configurable: true, value: MemoryStorage };
  Object.defineProperty(globalThis, "Storage", memoryStorageDescriptor);
  if (typeof window !== "undefined" && window !== globalThis) {
    Object.defineProperty(window, "Storage", memoryStorageDescriptor);
  }
}
const localStorageValue = useMemoryStorage ? new MemoryStorage() : candidateLocalStorage;
const sessionStorageValue = useMemoryStorage ? new MemoryStorage() : candidateSessionStorage;
const storageDescriptors = {
  localStorage: { configurable: true, value: localStorageValue },
  sessionStorage: { configurable: true, value: sessionStorageValue },
};

Object.defineProperties(globalThis, storageDescriptors);
if (useMemoryStorage && typeof window !== "undefined" && window !== globalThis) {
  Object.defineProperties(window, storageDescriptors);
}

// jsdom ships neither of these browser APIs, but cmdk (the command-palette engine) hard-depends on
// both: CommandList observes its size via ResizeObserver, and the active item is scrolled into view.
// Provide inert stubs so component tests can mount cmdk without crashing — they're observation/
// scroll niceties with no assertable behaviour in jsdom. The ResizeObserver stub is a clean no-op
// (observe/unobserve/disconnect do nothing); SchedulerGrid's `typeof ResizeObserver === 'undefined'`
// guard simply falls through to this inert observer under jsdom, which is harmless.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {} // no-op: never fires a resize callback under jsdom
    unobserve() {} // no-op
    disconnect() {} // no-op
  };
}
const browserGlobals = globalThis as unknown as {
  Element?: typeof Element;
  HTMLElement?: typeof HTMLElement;
};
const elementPrototype = browserGlobals.Element?.prototype;
if (elementPrototype && !Reflect.has(elementPrototype, "scrollIntoView")) {
  elementPrototype.scrollIntoView = () => {};
}
const pointerCapturePrototype = browserGlobals.HTMLElement?.prototype as
  Partial<Pick<HTMLElement, "setPointerCapture" | "hasPointerCapture" | "releasePointerCapture">> | undefined;
if (pointerCapturePrototype && typeof pointerCapturePrototype.setPointerCapture !== "function") {
  const capturedPointers = new WeakMap<HTMLElement, Set<number>>();
  pointerCapturePrototype.setPointerCapture = function (this: HTMLElement, pointerId) {
    const pointers = capturedPointers.get(this) ?? new Set<number>();
    pointers.add(pointerId);
    capturedPointers.set(this, pointers);
  };
  pointerCapturePrototype.hasPointerCapture = function (this: HTMLElement, pointerId) {
    return capturedPointers.get(this)?.has(pointerId) ?? false;
  };
  pointerCapturePrototype.releasePointerCapture = function (this: HTMLElement, pointerId) {
    capturedPointers.get(this)?.delete(pointerId);
  };
}

// Unmount React trees and reset jsdom between tests.
afterEach(() => {
  cleanup();
});
