import { afterEach, describe, expect, it, vi } from "vitest";
import { AUDIT_WARNING_EVENT } from "../lib/auditWarning";
import {
  apiFetch,
  isTransportFailure,
  requestSignal,
  API_REQUEST_TIMEOUT_MS,
  API_BULK_TIMEOUT_MS,
  setMasqueradeEndedHandler,
} from "./requestTimeout";

afterEach(() => {
  setMasqueradeEndedHandler(null);
  vi.unstubAllGlobals();
});

describe("isTransportFailure", () => {
  it.each([
    ["network TypeError", new TypeError("fetch failed")],
    ["caller abort", new DOMException("aborted", "AbortError")],
    ["request deadline", new DOMException("timed out", "TimeoutError")],
  ])("accepts %s", (_label, error) => {
    expect(isTransportFailure(error)).toBe(true);
  });

  it("does not reinterpret an ordinary application error as an offline transport failure", () => {
    expect(isTransportFailure(new Error("invalid response"))).toBe(false);
  });
});

describe("requestSignal tiers", () => {
  // AbortSignal.timeout schedules on an internal timer that fake timers don't intercept, so assert
  // the BOUND requested per tier rather than trying to fast-forward the deadline.
  it("uses the interactive 15s bound by default and the 120s bulk bound when asked", () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    requestSignal();
    expect(spy).toHaveBeenLastCalledWith(API_REQUEST_TIMEOUT_MS);
    requestSignal(undefined, API_BULK_TIMEOUT_MS);
    expect(spy).toHaveBeenLastCalledWith(API_BULK_TIMEOUT_MS);
    spy.mockRestore();
  });

  it("the null tier never arms a timeout (the keepalive unload flush)", () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    const signal = requestSignal(undefined, null);
    expect(spy).not.toHaveBeenCalled();
    expect(signal.aborted).toBe(false);
    spy.mockRestore();
  });

  it("honours the caller signal even with no timeout", () => {
    const controller = new AbortController();
    const signal = requestSignal(controller.signal, null);
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });
});

describe("apiFetch", () => {
  it("announces audit degradation from direct API response headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("{}", { status: 200, headers: { "x-capacitylens-audit-warning": "true" } })),
    );
    const listener = vi.fn();
    globalThis.addEventListener(AUDIT_WARNING_EVENT, listener);
    try {
      await apiFetch("/api/direct-action");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      globalThis.removeEventListener(AUDIT_WARNING_EVENT, listener);
    }
  });

  it("notifies the masquerade recovery owner when a projected read reports MASQUERADE_ENDED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "MASQUERADE_ENDED" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const ended = vi.fn();
    setMasqueradeEndedHandler(ended);
    const response = await apiFetch("/api/state");
    expect(response.status).toBe(403);
    expect(ended).toHaveBeenCalledOnce();
  });
});
