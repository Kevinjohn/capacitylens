import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../data/apiConfig", () => ({ API_BASE: "http://api.test" }));

import {
  cancelMicrosoftConnection,
  confirmMicrosoftConnection,
  getMicrosoftConnectionStatus,
  resendMicrosoftConnection,
  startMicrosoftConnection,
} from "./microsoftConnectionClient";

afterEach(() => vi.unstubAllGlobals());

describe("Microsoft connection client", () => {
  it("sends the intent with cookies and returns only an HTTP(S) provider URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ url: "https://login.microsoftonline.com/authorize" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startMicrosoftConnection({
        purpose: "bootstrap",
        email: "owner@example.com",
        callbackURL: "http://localhost:3000/",
        errorCallbackURL: "http://localhost:3000/?externalSignInError=1",
      }),
    ).resolves.toEqual({ data: { url: "https://login.microsoftonline.com/authorize" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/account/microsoft/start",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ purpose: "bootstrap", email: "owner@example.com" });
  });

  it("rejects an unsafe scheme returned as a provider URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ url: "javascript:alert(1)" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(
      startMicrosoftConnection({
        purpose: "invite",
        inviteToken: "invite-token",
        callbackURL: "/",
        errorCallbackURL: "/",
      }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("rejects malformed status and action responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ state: "success" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: false }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
    );

    await expect(getMicrosoftConnectionStatus()).rejects.toMatchObject({ status: 502 });
    await expect(resendMicrosoftConnection()).rejects.toMatchObject({ status: 502 });
  });

  it.each(["mail-secret", undefined])("posts confirmation proof only in the request body (%s)", async (token) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ url: "https://login.microsoftonline.com/authorize" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await confirmMicrosoftConnection(token);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/account/microsoft/confirm",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify(token ? { token } : {}),
      }),
    );
  });

  it("surfaces cancellation failure instead of accepting an error response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    await expect(cancelMicrosoftConnection()).rejects.toMatchObject({ status: 503 });
  });

  it("preserves the delivery failure flag and rejects malformed delivery status", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ state: "pending", deliveryUnavailable: true }))
        .mockResolvedValueOnce(Response.json({ state: "pending", deliveryUnavailable: "yes" })),
    );
    await expect(getMicrosoftConnectionStatus()).resolves.toEqual({ state: "pending", deliveryUnavailable: true });
    await expect(getMicrosoftConnectionStatus()).rejects.toMatchObject({ status: 502 });
  });
});
