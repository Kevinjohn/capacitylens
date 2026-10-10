import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: vi.fn<() => Promise<Response>>(),
  start: vi.fn<() => Promise<Response>>(),
  end: vi.fn<() => Promise<Response>>(),
}));

vi.mock("@/account/accountClient", () => ({
  accountClient: {
    masqueradeStatus: mocks.status,
    startMasquerade: mocks.start,
    endMasquerade: mocks.end,
  },
}));

import { masqueradeApi } from "./masqueradeApi";

const state = {
  accountId: "a-studio",
  targetUserId: "u-viewer",
  targetName: "Selina Kyle",
  effectiveRole: "viewer",
  startedAt: "2026-09-01T10:00:00.000Z",
  token: "token-1",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  mocks.status.mockReset();
  mocks.start.mockReset();
  mocks.end.mockReset();
});

describe("masqueradeApi", () => {
  it("decodes status transported by the account client", async () => {
    mocks.status.mockResolvedValue(json({ active: true, ...state }));

    await expect(masqueradeApi.status()).resolves.toEqual({ active: true, ...state });
    expect(mocks.status).toHaveBeenCalledOnce();
  });

  it("surfaces server-authored errors for start, status, and end", async () => {
    mocks.start.mockResolvedValue(json({ error: "Start denied." }, 403));
    mocks.status.mockResolvedValue(json({ error: "Status unavailable." }, 503));
    mocks.end.mockResolvedValue(json({ error: "End denied." }, 403));

    await expect(masqueradeApi.start("a-studio", "u-viewer")).rejects.toThrow("Start denied.");
    await expect(masqueradeApi.status()).rejects.toThrow("Status unavailable.");
    await expect(masqueradeApi.end("token-1", "explicit")).rejects.toThrow("End denied.");
  });

  it("retains the existing fallback when the server error body is unusable", async () => {
    mocks.status.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(masqueradeApi.status()).rejects.toThrow("Masquerade status could not be read (503).");
  });

  it("surfaces a decoded error when a successful response has no valid masquerade state", async () => {
    mocks.start.mockResolvedValue(json({ error: "Start state unavailable." }));
    mocks.status.mockResolvedValue(json({ error: "Status state unavailable." }));

    await expect(masqueradeApi.start("a-studio", "u-viewer")).rejects.toThrow("Start state unavailable.");
    await expect(masqueradeApi.status()).rejects.toThrow("Status state unavailable.");
  });

  it.each([
    ["an empty account id", { accountId: "" }],
    ["an empty target user id", { targetUserId: "" }],
    ["an empty token", { token: "" }],
    ["an invalid timestamp", { startedAt: "2026-02-30T10:00:00.000Z" }],
  ])("rejects active state with %s", async (_description, change) => {
    mocks.status.mockResolvedValue(json({ active: true, ...state, ...change }));

    await expect(masqueradeApi.status()).rejects.toThrow("The server returned an invalid masquerade status.");
  });

  it.each([
    ["missing state fields", {}],
    ["a non-string account id", { ...state, accountId: 1 }],
    ["an unsupported role", { ...state, effectiveRole: "auditor" }],
  ])("rejects active state with %s", async (_description, malformedState) => {
    mocks.status.mockResolvedValue(json({ active: true, ...malformedState }));

    await expect(masqueradeApi.status()).rejects.toThrow("The server returned an invalid masquerade status.");
  });

  it("rejects array response bodies for status and start", async () => {
    mocks.status.mockResolvedValue(json([]));
    mocks.start.mockResolvedValue(json([]));

    await expect(masqueradeApi.status()).rejects.toThrow("The server returned an invalid masquerade status.");
    await expect(masqueradeApi.start("a-studio", "u-viewer")).rejects.toThrow(
      "The server returned an invalid masquerade state.",
    );
  });

  it("preserves an empty target name", async () => {
    mocks.status.mockResolvedValue(json({ active: true, ...state, targetName: "" }));

    await expect(masqueradeApi.status()).resolves.toEqual({ active: true, ...state, targetName: "" });
  });
});
