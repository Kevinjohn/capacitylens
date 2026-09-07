import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isReauthPending,
  REAUTH_REQUEST_TIMEOUT_MS,
  requestReauth,
  completeReauth,
  subscribeReauth,
} from "./reauthCoordinator";

afterEach(() => {
  if (isReauthPending()) completeReauth(false);
  vi.useRealTimers();
});

describe("reauthCoordinator", () => {
  it.each([true, false])("deduplicates concurrent requests and resolves every waiter with %s", async (outcome) => {
    const listener = vi.fn();
    const unsubscribe = subscribeReauth(listener);

    const first = requestReauth();
    const second = requestReauth();

    expect(second).toBe(first);
    expect(isReauthPending()).toBe(true);
    expect(listener).toHaveBeenCalledOnce();

    completeReauth(outcome);

    await expect(Promise.all([first, second])).resolves.toEqual([outcome, outcome]);
    expect(isReauthPending()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("does not emit when resolution is requested without a pending transition", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeReauth(listener);

    completeReauth(true);

    expect(isReauthPending()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("stops notifying a subscriber after it unsubscribes", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeReauth(listener);
    unsubscribe();

    const pending = requestReauth();
    completeReauth(false);

    await expect(pending).resolves.toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("eventually cancels a request even when no React host can resolve it", async () => {
    vi.useFakeTimers();
    const outcome = requestReauth();

    await vi.advanceTimersByTimeAsync(REAUTH_REQUEST_TIMEOUT_MS);

    await expect(outcome).resolves.toBe(false);
    expect(isReauthPending()).toBe(false);
  });
});
