import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub the plain cache stores to isolate hook subscriptions from IndexedDB and the service worker.
const preference = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = {
    enabled: false,
    listeners,
    /** A frozen, stable reference, useSyncExternalStore loops on a snapshot that changes identity. */
    offlineState: Object.freeze({ readOnly: false }),
    publish(next: boolean) {
      state.enabled = next;
      for (const listener of listeners) listener();
    },
  };
  return state;
});

vi.mock("./offlineCache", () => ({
  isOfflineReadEnabled: () => preference.enabled,
  subscribeOfflinePreference: (listener: () => void) => {
    preference.listeners.add(listener);
    return () => preference.listeners.delete(listener);
  },
  readOfflineStateSnapshot: () => preference.offlineState,
  subscribeOfflineState: () => () => {},
}));

import { useOfflineReadEnabled, usePersistenceDiagnostics } from "./useOfflineState";
import {
  incrementPersistenceDiagnostic,
  resetPersistenceDiagnostics,
  setPersistenceSuspended,
} from "./persistenceDiagnostics";

beforeEach(() => {
  preference.enabled = false;
  preference.listeners.clear();
  resetPersistenceDiagnostics();
});

describe("useOfflineReadEnabled", () => {
  it("reports the stored preference", () => {
    preference.enabled = true;
    const { result } = renderHook(() => useOfflineReadEnabled());
    expect(result.current).toBe(true);
  });

  it("re-renders when the preference changes elsewhere", () => {
    const { result } = renderHook(() => useOfflineReadEnabled());
    expect(result.current).toBe(false);

    act(() => preference.publish(true));
    expect(result.current).toBe(true);
  });

  it("unsubscribes on unmount so a later publish cannot touch a dead component", () => {
    const { unmount } = renderHook(() => useOfflineReadEnabled());
    expect(preference.listeners.size).toBe(1);

    unmount();
    expect(preference.listeners.size).toBe(0);
  });
});

describe("usePersistenceDiagnostics", () => {
  it("reports the current counters", () => {
    const { result } = renderHook(() => usePersistenceDiagnostics());
    expect(result.current).toMatchObject({ savesFailed: 0, suspended: false });
  });

  it("re-renders when a counter is incremented", () => {
    const { result } = renderHook(() => usePersistenceDiagnostics());

    act(() => incrementPersistenceDiagnostic("savesFailed"));
    expect(result.current.savesFailed).toBe(1);
  });

  it("re-renders when persistence is suspended", () => {
    const { result } = renderHook(() => usePersistenceDiagnostics());

    act(() => setPersistenceSuspended(true));
    expect(result.current.suspended).toBe(true);
  });
});
