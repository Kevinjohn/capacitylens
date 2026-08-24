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
// Fall back to an in-memory Storage whenever the environment's own storage is missing or unusable,
// pinning the globals so tests that intercept Storage.prototype still exercise their
// quota/SecurityError paths when a real storage exists.
function usableStorage(candidate: unknown): Storage {
  return candidate && typeof (candidate as Storage).getItem === "function"
    ? (candidate as Storage)
    : new MemoryStorage();
}
Object.defineProperties(globalThis, {
  localStorage: {
    configurable: true,
    value: usableStorage(typeof window === "undefined" ? undefined : window.localStorage),
  },
  sessionStorage: {
    configurable: true,
    value: usableStorage(typeof window === "undefined" ? undefined : window.sessionStorage),
  },
});

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
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Unmount React trees and reset jsdom between tests.
afterEach(() => {
  cleanup();
});
