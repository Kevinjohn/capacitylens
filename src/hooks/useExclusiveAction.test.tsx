import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useExclusiveAction } from "./useExclusiveAction";

// The load-bearing property is the SAME-RENDER one: the ref must already refuse a second action
// inside the very click that started the first, before React has committed `busy = true` and had a
// chance to disable anything. A test that only asserts on `busy` would pass against a
// state-flag-only implementation and miss exactly the double-click this hook exists to stop.

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("useExclusiveAction", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => useExclusiveAction());
    expect(result.current.busy).toBe(false);
    expect(result.current.locked()).toBe(false);
  });

  it("locks synchronously, before React has committed the busy flag", () => {
    const pending = deferred();
    const { result } = renderHook(() => useExclusiveAction());
    const gate = result.current;

    act(() => {
      gate.run(() => pending.promise, vi.fn());
      // Same tick as the click: the ref is already closed while `busy` is still the pre-render value.
      expect(gate.locked()).toBe(true);
      expect(result.current.busy).toBe(false);
    });

    expect(result.current.busy).toBe(true);
  });

  it("discards a second action started while one is in flight", async () => {
    const pending = deferred();
    const second = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useExclusiveAction());
    const gate = result.current;

    act(() => {
      gate.run(() => pending.promise, vi.fn());
      gate.run(second, vi.fn()); // the double-click, in the same tick
    });
    expect(second).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });

    // Discarded, not queued: settling the first must not then run the suppressed one.
    expect(second).not.toHaveBeenCalled();
  });

  it("reopens the gate once the action settles", async () => {
    const pending = deferred();
    const { result } = renderHook(() => useExclusiveAction());

    act(() => result.current.run(() => pending.promise, vi.fn()));
    await act(async () => {
      pending.resolve();
      await pending.promise;
    });

    expect(result.current.busy).toBe(false);
    expect(result.current.locked()).toBe(false);

    const next = vi.fn(() => Promise.resolve());
    await act(async () => result.current.run(next, vi.fn()));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("surfaces a rejection to onError and still reopens the gate", async () => {
    const pending = deferred();
    const onError = vi.fn();
    const failure = new Error("the server refused");
    const { result } = renderHook(() => useExclusiveAction());

    act(() => result.current.run(() => pending.promise, onError));
    await act(async () => {
      pending.reject(failure);
      await pending.promise.catch(() => {});
    });

    expect(onError).toHaveBeenCalledWith(failure);
    // A failure must not wedge the section permanently disabled.
    expect(result.current.busy).toBe(false);
    expect(result.current.locked()).toBe(false);
  });

  it("keeps run and locked stable across renders so they are safe effect/callback dependencies", () => {
    const { result, rerender } = renderHook(() => useExclusiveAction());
    const { run, locked } = result.current;

    rerender();
    expect(result.current.run).toBe(run);
    expect(result.current.locked).toBe(locked);
  });
});
