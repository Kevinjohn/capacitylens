import { afterEach, describe, expect, it, vi } from "vitest";
import { AUDIT_WARNING_EVENT } from "@/lib/auditWarning";
import {
  apiFetch,
  isTransportFailure,
  readMasqueradeErrorCode,
  createRequestSignal,
  API_REQUEST_TIMEOUT_MS,
  API_BULK_TIMEOUT_MS,
  setMasqueradeEndedHandler,
} from "./requestTimeout";
import { MASQUERADE_ERROR_CODES } from "@capacitylens/shared/domain/masquerade";
import { getMasqueradeContextToken, setMasqueradeContextToken } from "@/auth/masqueradeContext";

afterEach(() => {
  setMasqueradeEndedHandler(null);
  setMasqueradeContextToken(null);
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
  // the bound requested per tier rather than trying to fast-forward the deadline.
  it("uses the interactive 15s bound by default and the 120s bulk bound when asked", () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    createRequestSignal();
    expect(spy).toHaveBeenLastCalledWith(API_REQUEST_TIMEOUT_MS);
    createRequestSignal(undefined, API_BULK_TIMEOUT_MS);
    expect(spy).toHaveBeenLastCalledWith(API_BULK_TIMEOUT_MS);
    spy.mockRestore();
  });

  it("the null tier never arms a timeout (the keepalive unload flush)", () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    const signal = createRequestSignal(undefined, null);
    expect(spy).not.toHaveBeenCalled();
    expect(signal.aborted).toBe(false);
    spy.mockRestore();
  });

  it("honours the caller signal even with no timeout", () => {
    const controller = new AbortController();
    const signal = createRequestSignal(controller.signal, null);
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });
});

describe("apiFetch", () => {
  it("recognizes only shared masquerade codes without consuming the response body", async () => {
    const response = new Response(JSON.stringify({ code: MASQUERADE_ERROR_CODES.readOnly }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });

    await expect(readMasqueradeErrorCode(response)).resolves.toBe(MASQUERADE_ERROR_CODES.readOnly);
    await expect(response.json()).resolves.toEqual({ code: MASQUERADE_ERROR_CODES.readOnly });
    await expect(
      readMasqueradeErrorCode(
        new Response(JSON.stringify({ code: "UNKNOWN" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ).resolves.toBeNull();
  });

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

  it("captures the current context for reads and writes while preserving explicit action context", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    setMasqueradeContextToken("newer-context");

    await apiFetch("/api/write", { method: "POST" });
    await apiFetch("/api/write", { method: "POST", headers: { "X-Masquerade-Context": "captured-context" } });
    await apiFetch("/api/read");
    await apiFetch("/api/read", { headers: { "X-Masquerade-Context": "captured-read-context" } });
    await apiFetch("/api/read", { method: "HEAD" });
    await apiFetch("/api/preflight", { method: "OPTIONS" });

    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("X-Masquerade-Context")).toBe("newer-context");
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("X-Masquerade-Context")).toBe("captured-context");
    expect(new Headers(fetcher.mock.calls[2]?.[1]?.headers).get("X-Masquerade-Context")).toBe("newer-context");
    expect(new Headers(fetcher.mock.calls[3]?.[1]?.headers).get("X-Masquerade-Context")).toBe("captured-read-context");
    expect(new Headers(fetcher.mock.calls[4]?.[1]?.headers).get("X-Masquerade-Context")).toBe("newer-context");
    expect(new Headers(fetcher.mock.calls[5]?.[1]?.headers).has("X-Masquerade-Context")).toBe(false);
    expect(getMasqueradeContextToken()).toBe("newer-context");
  });

  it.each([
    ["ended", 403],
    ["context changed", 409],
    ["context required", 428],
  ])("notifies the masquerade recovery owner when a request reports %s", async (label, status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: MASQUERADE_ERROR_CODES[
              label === "ended" ? "ended" : label === "context changed" ? "contextChanged" : "contextRequired"
            ],
          }),
          {
            status,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );
    const ended = vi.fn();
    setMasqueradeEndedHandler(ended);
    const response = await apiFetch("/api/state");
    expect(response.status).toBe(status);
    expect(ended).toHaveBeenCalledOnce();
  });
});
