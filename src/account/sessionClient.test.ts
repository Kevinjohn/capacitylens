import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}));

vi.mock("../data/apiConfig", () => ({ API_BASE: "https://app.example" }));
vi.mock("../data/requestTimeout", () => ({ apiFetch: mocks.apiFetch }));

import { listSessions, type SessionView } from "./sessionClient";
import { jsonResponse } from "../test/fixtures";

const SESSION: SessionView = {
  id: "opaque-session-handle",
  createdAt: "2026-07-14T12:00:00.000Z",
  expiresAt: "2026-07-15T00:00:00.000Z",
  current: false,
};

describe("browser session client", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads valid sessions through apiFetch with credentials included", async () => {
    const sessions = [SESSION, { ...SESSION, id: "new-current-session", current: true }];
    mocks.apiFetch.mockResolvedValue(jsonResponse({ sessions }));

    expect(await listSessions()).toEqual({ kind: "loaded", sessions });
    expect(mocks.apiFetch).toHaveBeenCalledExactlyOnceWith("https://app.example/api/account/sessions", {
      credentials: "include",
    });
  });

  it("loads an empty session list", async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse({ sessions: [] }));
    expect(await listSessions()).toEqual({ kind: "loaded", sessions: [] });
  });

  it("accepts a null expiry", async () => {
    const sessions = [{ ...SESSION, expiresAt: null }];
    mocks.apiFetch.mockResolvedValue(jsonResponse({ sessions }));
    expect(await listSessions()).toEqual({ kind: "loaded", sessions });
  });

  it.each(["unreadable JSON", JSON.stringify({ sessions: [SESSION] }), "null"])(
    "returns unauthorized for HTTP 401 regardless of body: %s",
    async (body) => {
      mocks.apiFetch.mockResolvedValue(new Response(body, { status: 401 }));
      expect(await listSessions()).toEqual({ kind: "unauthorized" });
    },
  );

  it.each([403, 404, 503])("returns failed for HTTP %i even with valid sessions", async (status) => {
    mocks.apiFetch.mockResolvedValue(jsonResponse({ sessions: [SESSION] }, status));
    expect(await listSessions()).toEqual({ kind: "failed" });
  });

  it("returns failed when sessions are temporarily unavailable", async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse({ error: "Sessions are temporarily unavailable." }, 503));
    expect(await listSessions()).toEqual({ kind: "failed" });
  });

  it("returns failed for unreadable JSON", async () => {
    mocks.apiFetch.mockResolvedValue(new Response("not JSON"));
    expect(await listSessions()).toEqual({ kind: "failed" });
  });

  it.each([null, [], "sessions", 42, true, {}, { sessions: null }, { sessions: {} }])(
    "returns failed for a malformed envelope: %j",
    async (body) => {
      mocks.apiFetch.mockResolvedValue(jsonResponse(body));
      expect(await listSessions()).toEqual({ kind: "failed" });
    },
  );

  it.each([
    ["null row", null],
    ["primitive row", "session"],
    ["array row", []],
    ["missing fields", {}],
    ["short id", { ...SESSION, id: "short" }],
    ["long id", { ...SESSION, id: "a".repeat(129) }],
    ["invalid id characters", { ...SESSION, id: "invalid session handle" }],
    ["non-string id", { ...SESSION, id: 123 }],
    ["missing createdAt", { ...SESSION, createdAt: undefined }],
    ["non-string createdAt", { ...SESSION, createdAt: 123 }],
    ["invalid createdAt", { ...SESSION, createdAt: "not a date" }],
    ["missing expiresAt", { ...SESSION, expiresAt: undefined }],
    ["non-string expiresAt", { ...SESSION, expiresAt: 123 }],
    ["invalid expiresAt", { ...SESSION, expiresAt: "not a date" }],
    ["missing current", { ...SESSION, current: undefined }],
    ["non-boolean current", { ...SESSION, current: "false" }],
  ])("rejects the whole list for %s", async (_name, row) => {
    mocks.apiFetch.mockResolvedValue(jsonResponse({ sessions: [SESSION, row] }));
    expect(await listSessions()).toEqual({ kind: "invalid" });
  });

  it("logs transport failures and returns failed without rethrowing", async () => {
    const cause = new TypeError("network failed");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.apiFetch.mockRejectedValue(cause);

    expect(await listSessions()).toEqual({ kind: "failed" });
    expect(error).toHaveBeenCalledExactlyOnceWith("sessionClient: session list failed", cause);
  });
});
