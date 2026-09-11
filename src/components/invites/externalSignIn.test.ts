import { afterEach, describe, expect, it, vi } from "vitest";
import { EXTERNAL_NAVIGATION_TIMEOUT_MS, runExternalSignIn } from "./externalSignIn";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runExternalSignIn", () => {
  it("keeps the attempt pending beyond the former 100 ms redirect guess", async () => {
    vi.useFakeTimers();
    const onFailure = vi.fn();
    const navigate = vi.fn();
    const attempt = runExternalSignIn({
      start: async () => ({ data: { url: "https://identity.example.test/start" }, error: null }),
      onFailure,
      onRequestError: vi.fn(),
      onCachedReturn: vi.fn(),
      navigate,
    });

    await vi.advanceTimersByTimeAsync(101);
    expect(onFailure).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("https://identity.example.test/start");

    window.dispatchEvent(new Event("pagehide"));
    await attempt;
  });

  it("restores retry controls only after the bounded navigation-start window expires", async () => {
    vi.useFakeTimers();
    const onFailure = vi.fn();
    const attempt = runExternalSignIn({
      start: async () => ({ data: { url: "https://identity.example.test/start" }, error: null }),
      onFailure,
      onRequestError: vi.fn(),
      onCachedReturn: vi.fn(),
      navigate: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(EXTERNAL_NAVIGATION_TIMEOUT_MS - 1);
    expect(onFailure).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await attempt;
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it("bounds a provider request that never settles", async () => {
    vi.useFakeTimers();
    const onFailure = vi.fn();
    let requestSignal: AbortSignal | undefined;
    const attempt = runExternalSignIn({
      start: (signal) => {
        requestSignal = signal;
        return new Promise(() => {});
      },
      onFailure,
      onRequestError: vi.fn(),
      onCachedReturn: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(EXTERNAL_NAVIGATION_TIMEOUT_MS);
    await attempt;
    expect(onFailure).toHaveBeenCalledOnce();
    expect(requestSignal?.aborted).toBe(true);
  });

  it("aborts a timed-out first attempt before a second starts, so its late response cannot redirect", async () => {
    vi.useFakeTimers();
    let finishFirst!: () => void;
    let firstSignal: AbortSignal | undefined;
    const firstNavigate = vi.fn();
    const firstFailure = vi.fn();
    const first = runExternalSignIn({
      start: (signal) => {
        firstSignal = signal;
        return new Promise((resolve) => {
          finishFirst = () => {
            // Deliberately resolves even though the signal was aborted, proving that ownership does
            // not depend on every transport implementation honoring cancellation perfectly.
            resolve({ data: { url: "https://first.example.test/start" }, error: null });
          };
        });
      },
      onFailure: firstFailure,
      onRequestError: vi.fn(),
      onCachedReturn: vi.fn(),
      navigate: firstNavigate,
      navigationTimeoutMs: 25,
    });

    await vi.advanceTimersByTimeAsync(25);
    await first;
    expect(firstFailure).toHaveBeenCalledOnce();
    expect(firstSignal?.aborted).toBe(true);

    let secondSignal: AbortSignal | undefined;
    const secondNavigate = vi.fn();
    const second = runExternalSignIn({
      start: async (signal) => {
        secondSignal = signal;
        return { data: { url: "https://second.example.test/start" }, error: null };
      },
      onFailure: vi.fn(),
      onRequestError: vi.fn(),
      onCachedReturn: vi.fn(),
      navigate: secondNavigate,
      navigationTimeoutMs: 25,
    });
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event("pagehide"));
    await second;

    finishFirst();
    await Promise.resolve();
    expect(firstNavigate).not.toHaveBeenCalled();
    expect(secondNavigate).toHaveBeenCalledOnce();
    expect(secondNavigate).toHaveBeenCalledWith("https://second.example.test/start");
    expect(secondSignal?.aborted).toBe(true);
  });

  it("retires a pending provider request on pagehide while preserving bfcache restoration", async () => {
    let requestSignal: AbortSignal | undefined;
    const onCachedReturn = vi.fn();
    const attempt = runExternalSignIn({
      start: (signal) => {
        requestSignal = signal;
        return new Promise(() => {});
      },
      onFailure: vi.fn(),
      onRequestError: vi.fn(),
      onCachedReturn,
    });

    window.dispatchEvent(new Event("pagehide"));
    await attempt;
    expect(requestSignal?.aborted).toBe(true);

    const restored = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(restored, "persisted", { value: true });
    window.dispatchEvent(restored);
    expect(onCachedReturn).toHaveBeenCalledOnce();
  });

  it("rejects an unsafe provider URL without attempting navigation", async () => {
    const onFailure = vi.fn();
    const navigate = vi.fn();

    await runExternalSignIn({
      start: async () => ({ data: { url: "javascript:alert(1)" }, error: null }),
      onFailure,
      onRequestError: vi.fn(),
      onCachedReturn: vi.fn(),
      navigate,
    });

    expect(onFailure).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("routes a synchronous provider startup throw through request recovery", async () => {
    const error = new Error("provider construction failed");
    const onRequestError = vi.fn();

    await expect(
      runExternalSignIn({
        start: () => {
          throw error;
        },
        onFailure: vi.fn(),
        onRequestError,
        onCachedReturn: vi.fn(),
      }),
    ).resolves.toBeUndefined();

    expect(onRequestError).toHaveBeenCalledOnce();
    expect(onRequestError).toHaveBeenCalledWith(error);
  });

  it("routes an asynchronously rejected provider request through request recovery", async () => {
    const error = new Error("provider request failed");
    const onRequestError = vi.fn();

    await runExternalSignIn({
      start: async () => Promise.reject(error),
      onFailure: vi.fn(),
      onRequestError,
      onCachedReturn: vi.fn(),
    });

    expect(onRequestError).toHaveBeenCalledOnce();
    expect(onRequestError).toHaveBeenCalledWith(error);
  });
});
