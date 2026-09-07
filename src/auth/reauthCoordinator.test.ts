import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isReauthPending,
  REAUTH_REQUEST_TIMEOUT_MS,
  requestReauth,
  completeReauth,
  readReauthResolution,
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
    const beforeResolution = readReauthResolution();

    const first = requestReauth();
    const second = requestReauth();

    expect(second).toBe(first);
    expect(isReauthPending()).toBe(true);
    expect(listener).toHaveBeenCalledOnce();

    completeReauth(outcome);

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual(outcome ? { kind: "authenticated" } : { kind: "cancelled" });
    expect(secondResult).toBe(firstResult);
    const afterResolution = readReauthResolution();
    expect(afterResolution.epoch).toBe(beforeResolution.epoch + 1);
    expect(afterResolution.outcome).toBe(firstResult);
    completeReauth(!outcome);
    expect(readReauthResolution()).toBe(afterResolution);
    expect(readReauthResolution().epoch).toBe(afterResolution.epoch);
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

    await expect(pending).resolves.toEqual({ kind: "cancelled" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("eventually cancels a request even when no React host can resolve it", async () => {
    vi.useFakeTimers();
    const outcome = requestReauth();

    await vi.advanceTimersByTimeAsync(REAUTH_REQUEST_TIMEOUT_MS);

    await expect(outcome).resolves.toEqual({ kind: "cancelled" });
    expect(isReauthPending()).toBe(false);
  });
});
