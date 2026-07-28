import { afterEach, describe, expect, it, vi } from "vitest";
import {
  reauthPending,
  REAUTH_REQUEST_TIMEOUT_MS,
  requestReauth,
  resolveReauth,
  subscribeReauth,
} from "./reauthCoordinator";

afterEach(() => {
  if (reauthPending()) resolveReauth(false);
  vi.useRealTimers();
});

describe("reauthCoordinator", () => {
  it.each([true, false])("deduplicates concurrent requests and resolves every waiter with %s", async (outcome) => {
    const listener = vi.fn();
    const unsubscribe = subscribeReauth(listener);

    const first = requestReauth();
    const second = requestReauth();

    expect(second).toBe(first);
    expect(reauthPending()).toBe(true);
    expect(listener).toHaveBeenCalledOnce();

    resolveReauth(outcome);

    await expect(Promise.all([first, second])).resolves.toEqual([outcome, outcome]);
    expect(reauthPending()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("does not emit when resolution is requested without a pending transition", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeReauth(listener);

    resolveReauth(true);

    expect(reauthPending()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("stops notifying a subscriber after it unsubscribes", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeReauth(listener);
    unsubscribe();

    const pending = requestReauth();
    resolveReauth(false);

    await expect(pending).resolves.toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("eventually cancels a request even when no React host can resolve it", async () => {
    vi.useFakeTimers();
    const outcome = requestReauth();

    await vi.advanceTimersByTimeAsync(REAUTH_REQUEST_TIMEOUT_MS);

    await expect(outcome).resolves.toBe(false);
    expect(reauthPending()).toBe(false);
  });
});
