import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetchReauth } from "./apiFetchReauth";
import { reauthPending, resolveReauth } from "./reauthCoordinator";

// DEFECT B — the step-up interception seam. apiFetchReauth wraps apiFetch and, on the server's
// SESSION_NOT_FRESH 403, raises the shared re-auth request (the dialog is driven off reauthPending)
// and — after a successful re-auth — transparently RE-ISSUES the identical request. A cancel or a
// non-freshness response passes straight through, untouched.

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  // Never leak a pending step-up into the next test (the coordinator is a module singleton).
  if (reauthPending()) resolveReauth(false);
  vi.unstubAllGlobals();
});

describe("apiFetchReauth", () => {
  it("passes an ordinary 200 straight through and never raises a step-up", async () => {
    const fetchMock = vi.fn(async () => json(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await apiFetchReauth("http://api.test/api/accounts/a1", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(reauthPending()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a plain 403 WITHOUT the SESSION_NOT_FRESH code is not intercepted", async () => {
    const fetchMock = vi.fn(async () => json(403, { error: "Forbidden." }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await apiFetchReauth("http://api.test/api/accounts/a1", {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
    expect(reauthPending()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a SESSION_NOT_FRESH 403 raises the step-up, then RETRIES the identical request after a successful re-auth", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(403, { error: "Sign in again first.", code: "SESSION_NOT_FRESH" }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = apiFetchReauth("http://api.test/api/accounts/a1", {
      method: "DELETE",
      headers: { "Idempotency-Key": "delete-a1" },
    });
    // The dialog trigger: a step-up becomes pending, and we have NOT retried yet.
    await vi.waitFor(() => expect(reauthPending()).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveReauth(true); // the dialog reports a fresh session
    const res = await pending;
    expect(res.status).toBe(200); // the retried request's response, handed back transparently
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reauthPending()).toBe(false);
  });

  it("also retries a freshness-gated privileged directory GET", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(403, { error: "Sign in again first.", code: "SESSION_NOT_FRESH" }))
      .mockResolvedValueOnce(json(200, { members: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = apiFetchReauth("http://api.test/api/accounts/a1/members");
    await vi.waitFor(() => expect(reauthPending()).toBe(true));
    resolveReauth(true);

    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("replays a Request body after successful re-authentication", async () => {
    const bodies: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      bodies.push(await request.text());
      return bodies.length === 1
        ? json(403, {
            error: "Sign in again first.",
            code: "SESSION_NOT_FRESH",
          })
        : json(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request("http://api.test/api/command", {
      method: "POST",
      headers: { "Idempotency-Key": "command-1" },
      body: "payload",
    });

    const pending = apiFetchReauth(request);
    await vi.waitFor(() => expect(reauthPending()).toBe(true));
    resolveReauth(true);

    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(bodies).toEqual(["payload", "payload"]);
    expect(request.bodyUsed).toBe(false);
  });

  it("rejects a one-shot RequestInit stream before dispatch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const body = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    await expect(
      apiFetchReauth("http://api.test/api/command", {
        method: "POST",
        body,
        duplex: "half",
      } as RequestInit),
    ).rejects.toThrow(/one-shot RequestInit stream/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a cancelled step-up returns the ORIGINAL 403 with its body intact and does not retry", async () => {
    const fetchMock = vi.fn(async () => json(403, { error: "Sign in again first.", code: "SESSION_NOT_FRESH" }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = apiFetchReauth("http://api.test/api/accounts/a1", {
      method: "DELETE",
      headers: { "Idempotency-Key": "delete-a1" },
    });
    await vi.waitFor(() => expect(reauthPending()).toBe(true));

    resolveReauth(false); // the user cancels the dialog
    const res = await pending;
    expect(res.status).toBe(403);
    // The body was only ever peeked at via clone(), so the caller can still read it (readApiError).
    expect(await res.json()).toMatchObject({ code: "SESSION_NOT_FRESH" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
