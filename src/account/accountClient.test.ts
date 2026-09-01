import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiFetch: vi
    .fn<(url: string, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValue(new Response(null, { status: 204 })),
  apiFetchReauth: vi
    .fn<(url: string, init?: RequestInit, timeout?: number) => Promise<Response>>()
    .mockResolvedValue(new Response(null, { status: 204 })),
  requestSignal: vi.fn((signal?: AbortSignal) => signal),
}));

vi.mock("../data/apiConfig", () => ({ API_BASE: "https://app.example" }));
vi.mock("../data/requestTimeout", () => ({
  apiFetch: mocks.apiFetch,
  API_BULK_TIMEOUT_MS: 120_000,
  requestSignal: mocks.requestSignal,
}));
vi.mock("../auth/apiFetchReauth", () => ({
  apiFetchReauth: mocks.apiFetchReauth,
}));

import {
  accountClient,
  accountCommandOutcomeUnknown,
  accountCommandOutcomeWasUnknown,
  bindStoredAccountCommandsToIdentity,
  clearStoredAccountCommands,
  newBrowserAccountCommand,
} from "./accountClient";
import { announceAuditWarning, AUDIT_WARNING_EVENT } from "../lib/auditWarning";

const command = { commandId: "command-1", idempotencyKey: "key-1" };

function expectCommand(init: RequestInit, method: string): void {
  expect(init.method).toBe(method);
  const headers = new Headers(init.headers);
  expect(headers.get("idempotency-key")).toBe(command.idempotencyKey);
  expect(headers.get("x-account-command-id")).toBe(command.commandId);
}

describe("browser account client", () => {
  beforeEach(() => {
    clearStoredAccountCommands();
    mocks.apiFetch.mockReset().mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    mocks.apiFetchReauth.mockReset().mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    mocks.requestSignal.mockClear();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates independent command and idempotency secrets", () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000000")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001");
    expect(newBrowserAccountCommand()).toEqual({
      commandId: "00000000-0000-4000-8000-000000000000",
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("owns unauthenticated status and workspace-list reads via apiFetch", async () => {
    // Routed through apiFetch (not raw fetch) so the audit-degradation header check that apiFetch
    // performs applies uniformly to these reads too.
    const controller = new AbortController();

    await accountClient.me(controller.signal);
    await accountClient.listWorkspaces(controller.signal);

    expect(mocks.apiFetch).toHaveBeenNthCalledWith(1, "https://app.example/api/auth/me", {
      credentials: "include",
      signal: controller.signal,
    });
    expect(mocks.apiFetch).toHaveBeenNthCalledWith(2, "https://app.example/api/accounts", {
      credentials: "include",
      signal: controller.signal,
    });
  });

  it("surfaces an audit-degradation warning when apiFetch reports one for /api/auth/me", async () => {
    // accountClient.me used to call raw `fetch` directly, bypassing apiFetch's audit-degradation
    // header check entirely (the regression this test pins). Simulate apiFetch's real header-check
    // behavior (mirrors requestTimeout.ts's apiFetch, covered directly in requestTimeout.test.ts) so
    // this test proves accountClient.me's OWN wiring reaches apiFetch rather than a bespoke fetch.
    const warning = vi.fn();
    globalThis.addEventListener(AUDIT_WARNING_EVENT, warning);
    mocks.apiFetch.mockImplementation(async () => {
      const res = new Response("{}", { status: 200, headers: { "x-capacitylens-audit-warning": "true" } });
      if (res.headers.get("x-capacitylens-audit-warning") === "true") announceAuditWarning();
      return res;
    });

    try {
      await accountClient.me();
      expect(warning).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.removeEventListener(AUDIT_WARNING_EVENT, warning);
    }
  });

  it("adds command headers, JSON encoding, safe path encoding, reauth, and bulk timeout policy", async () => {
    await accountClient.createWorkspace({ name: "Studio" }, command);
    await accountClient.eraseWorkspace("workspace / one", command);
    await accountClient.changeMemberRole("workspace / one", "person / one", "editor", command);
    await accountClient.removeMember("workspace / one", "person / one", command);
    await accountClient.transferOwnership("workspace / one", "person / one", command);
    await accountClient.issuePasswordReset("workspace / one", "person / one", command);
    await accountClient.revokeMemberSessions("workspace / one", "person / one", command);
    await accountClient.createInvitation({ accountId: "workspace / one", role: "viewer" }, command);
    await accountClient.revokeInvitation("workspace / one", "invite / one", command);

    const [createUrl, createInit] = mocks.apiFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(createUrl).toBe("https://app.example/api/orgs");
    expectCommand(createInit, "POST");
    expect(new Headers(createInit.headers).get("content-type")).toBe("application/json");
    expect(createInit.body).toBe(JSON.stringify({ name: "Studio" }));

    const [eraseUrl, eraseInit, eraseTimeout] = mocks.apiFetchReauth.mock.calls[0] as unknown as [
      string,
      RequestInit,
      number,
    ];
    expect(eraseUrl).toBe("https://app.example/api/accounts/workspace%20%2F%20one");
    expectCommand(eraseInit, "DELETE");
    expect(eraseTimeout).toBe(120_000);

    const urls = mocks.apiFetchReauth.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://app.example/api/accounts/workspace%20%2F%20one/members/person%20%2F%20one",
        "https://app.example/api/accounts/workspace%20%2F%20one/transfer-ownership",
        "https://app.example/api/accounts/workspace%20%2F%20one/members/person%20%2F%20one/reset-password",
        "https://app.example/api/accounts/workspace%20%2F%20one/members/person%20%2F%20one/revoke-sessions",
        "https://app.example/api/accounts/workspace%20%2F%20one/invites/invite%20%2F%20one",
      ]),
    );
  });

  it("owns member, invitation preview, acceptance, and signup routes", async () => {
    await accountClient.listMembers("workspace / one");
    await accountClient.listInvitations("workspace / one");
    await accountClient.startMasquerade("workspace / one", { targetUserId: "person / one" });
    await accountClient.masqueradeStatus();
    await accountClient.endMasquerade({ token: "token-1", reason: "explicit" });
    await accountClient.previewInvitation("token / one");
    await accountClient.acceptInvitation("token / one", command);
    await accountClient.signupWithInvitation("token / one", { name: "New user" }, command);

    const privilegedUrls = mocks.apiFetchReauth.mock.calls.map((call) => String(call[0]));
    expect(privilegedUrls).toEqual([
      "https://app.example/api/accounts/workspace%20%2F%20one/members",
      "https://app.example/api/accounts/workspace%20%2F%20one/invites",
    ]);
    const urls = mocks.apiFetch.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual([
      "https://app.example/api/accounts/workspace%20%2F%20one/masquerade",
      "https://app.example/api/masquerade",
      "https://app.example/api/masquerade",
      "https://app.example/api/invites/token%20%2F%20one/preview",
      "https://app.example/api/invites/token%20%2F%20one/accept",
      "https://app.example/api/invites/token%20%2F%20one/signup",
    ]);
    expect(mocks.apiFetch.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ targetUserId: "person / one" }),
    });
    expect(mocks.apiFetch.mock.calls[1]![1]).toEqual({ credentials: "include" });
    expect(mocks.apiFetch.mock.calls[2]![1]).toMatchObject({
      method: "DELETE",
      credentials: "include",
      body: JSON.stringify({ token: "token-1", reason: "explicit" }),
    });
    expectCommand(mocks.apiFetch.mock.calls[4]![1]!, "POST");
    expectCommand(mocks.apiFetch.mock.calls[5]![1]!, "POST");
  });

  it("keeps reconciliation bearers out of the URL", async () => {
    await accountClient.reconcileCommand(command, "password-reset");

    const [url, init] = mocks.apiFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://app.example/api/account-commands/reconcile");
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      operation: "password-reset",
    });
    expect(url).not.toContain(command.commandId);
    expect(url).not.toContain(command.idempotencyKey);
  });

  it("reuses a stored command across unknown outcomes and rotates it after terminal completion", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000003")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000004");
    mocks.apiFetch
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await accountClient.createWorkspace({ name: "Studio" });
    await accountClient.createWorkspace({ name: "Studio" });
    await accountClient.createWorkspace({ name: "Studio" });

    const commandIds = mocks.apiFetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("x-account-command-id"),
    );
    expect(commandIds).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000003",
    ]);
  });

  it("reuses a stored command after HTTP 408 until a terminal completion is known", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000071")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000072")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000073")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000074");
    mocks.apiFetch
      .mockResolvedValueOnce(new Response(null, { status: 408 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await accountClient.createWorkspace({ name: "Timeout Studio" });
    await accountClient.createWorkspace({ name: "Timeout Studio" });
    await accountClient.createWorkspace({ name: "Timeout Studio" });

    const commandIds = mocks.apiFetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("x-account-command-id"),
    );
    expect(commandIds).toEqual([
      "00000000-0000-4000-8000-000000000071",
      "00000000-0000-4000-8000-000000000071",
      "00000000-0000-4000-8000-000000000073",
    ]);
  });

  it("retains an implicit erasure command across an ambiguous post-delete 403", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000061")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000062")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000063")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000064");
    mocks.apiFetchReauth
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const ambiguous = await accountClient.eraseWorkspace("workspace-1");
    expect(accountCommandOutcomeWasUnknown(ambiguous)).toBe(true);
    await accountClient.eraseWorkspace("workspace-1");
    await accountClient.eraseWorkspace("workspace-1");

    const commandIds = mocks.apiFetchReauth.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("x-account-command-id"),
    );
    expect(commandIds).toEqual([
      "00000000-0000-4000-8000-000000000061",
      "00000000-0000-4000-8000-000000000061",
      "00000000-0000-4000-8000-000000000063",
    ]);
  });

  it("reuses an in-memory command when session storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Access denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Access denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Access denied", "SecurityError");
    });
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000051")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000052")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000053")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000054");
    mocks.apiFetch
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await accountClient.createWorkspace({ name: "Studio" });
    await accountClient.createWorkspace({ name: "Studio" });
    await accountClient.createWorkspace({ name: "Studio" });

    const commandIds = mocks.apiFetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("x-account-command-id"),
    );
    expect(commandIds).toEqual([
      "00000000-0000-4000-8000-000000000051",
      "00000000-0000-4000-8000-000000000051",
      "00000000-0000-4000-8000-000000000053",
    ]);
  });

  it("keeps a command after an in-progress conflict but clears it after an idempotency conflict", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000003")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000004")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000005")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000006");
    mocks.apiFetch
      .mockResolvedValueOnce(Response.json({ code: "COMMAND_IN_PROGRESS" }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ code: "IDEMPOTENCY_CONFLICT" }, { status: 409 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await accountClient.createWorkspace({ name: "Studio" });
    await accountClient.createWorkspace({ name: "Studio" });
    await accountClient.createWorkspace({ name: "Studio" });

    const commandIds = mocks.apiFetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("x-account-command-id"),
    );
    expect(commandIds).toEqual([
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000005",
    ]);
  });

  it("clears retained command ceremonies without removing unrelated per-tab data", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000061")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000062")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000063")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000064");
    mocks.apiFetch
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    sessionStorage.setItem("capacitylens.unrelated-preference", "keep");

    await accountClient.createWorkspace({ name: "Shared browser" });
    clearStoredAccountCommands();
    await accountClient.createWorkspace({ name: "Shared browser" });

    const commandIds = mocks.apiFetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("x-account-command-id"),
    );
    expect(commandIds).toEqual(["00000000-0000-4000-8000-000000000061", "00000000-0000-4000-8000-000000000063"]);
    expect(sessionStorage.getItem("capacitylens.unrelated-preference")).toBe("keep");
    expect(
      Array.from({ length: sessionStorage.length }, (_unused, index) => sessionStorage.key(index)),
    ).not.toContainEqual(expect.stringMatching(/^capacitylens\.account-command\./));
  });

  it("retains same-user recovery but clears a ceremony before a different identity can use it", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000081")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000082")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000083")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000084");
    mocks.apiFetch
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    bindStoredAccountCommandsToIdentity("user-one");
    await accountClient.createWorkspace({ name: "Shared browser" });
    bindStoredAccountCommandsToIdentity("user-one");
    await accountClient.createWorkspace({ name: "Shared browser" });
    bindStoredAccountCommandsToIdentity("user-two");
    await accountClient.createWorkspace({ name: "Shared browser" });

    const commandIds = mocks.apiFetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("x-account-command-id"),
    );
    expect(commandIds).toEqual([
      "00000000-0000-4000-8000-000000000081",
      "00000000-0000-4000-8000-000000000081",
      "00000000-0000-4000-8000-000000000083",
    ]);
    expect(sessionStorage.getItem("capacitylens.account-command.identity")).toBe("user-two");
  });

  it("isolates a surviving stored ceremony when identity-change cleanup cannot enumerate storage", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000091")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000092")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000093")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000094");
    mocks.apiFetch
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    bindStoredAccountCommandsToIdentity("user-one");
    await accountClient.createWorkspace({ name: "Shared browser" });
    vi.spyOn(Storage.prototype, "length", "get").mockImplementationOnce(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    bindStoredAccountCommandsToIdentity("user-two");
    await accountClient.createWorkspace({ name: "Shared browser" });

    const commandIds = mocks.apiFetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("x-account-command-id"),
    );
    expect(commandIds).toEqual(["00000000-0000-4000-8000-000000000091", "00000000-0000-4000-8000-000000000093"]);
  });

  it("keeps the same command identity after an unreadable 409 response", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000041")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000042")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000043")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000044");
    mocks.apiFetch
      .mockResolvedValueOnce(new Response("truncated", { status: 409 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await accountClient.createWorkspace({ name: "Studio" });
    await accountClient.createWorkspace({ name: "Studio" });

    const commandIds = mocks.apiFetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("x-account-command-id"),
    );
    expect(commandIds).toEqual(["00000000-0000-4000-8000-000000000041", "00000000-0000-4000-8000-000000000041"]);
  });

  it("does not let an explicit command discard an implicit unknown-outcome ceremony", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000031")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000032");
    mocks.apiFetch
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await accountClient.createWorkspace({ name: "Studio" });
    await accountClient.createWorkspace({ name: "Studio" }, command);
    await accountClient.createWorkspace({ name: "Studio" });

    const commandIds = mocks.apiFetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("x-account-command-id"),
    );
    expect(commandIds).toEqual([
      "00000000-0000-4000-8000-000000000031",
      command.commandId,
      "00000000-0000-4000-8000-000000000031",
    ]);
  });

  it("keeps unknown-outcome ceremonies separate for different semantic payloads", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000011")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000012")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000013")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000014");
    mocks.apiFetch.mockResolvedValue(new Response(null, { status: 503 }));

    await accountClient.createWorkspace({ name: "Studio A" });
    await accountClient.createWorkspace({ name: "Studio B" });
    await accountClient.createWorkspace({ name: "Studio A" });

    const commandIds = mocks.apiFetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("x-account-command-id"),
    );
    expect(commandIds).toEqual([
      "00000000-0000-4000-8000-000000000011",
      "00000000-0000-4000-8000-000000000013",
      "00000000-0000-4000-8000-000000000011",
    ]);
  });

  it("treats object key order as irrelevant when binding a semantic payload", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000021")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000022");
    mocks.apiFetch.mockResolvedValue(new Response(null, { status: 503 }));

    await accountClient.createWorkspace({ name: "Studio", color: "#fff" });
    await accountClient.createWorkspace({ color: "#fff", name: "Studio" });

    const commandIds = mocks.apiFetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("x-account-command-id"),
    );
    expect(commandIds).toEqual(["00000000-0000-4000-8000-000000000021", "00000000-0000-4000-8000-000000000021"]);
  });

  it("classifies server and in-progress responses as unknown without consuming the body", async () => {
    const inProgress = Response.json({ code: "COMMAND_IN_PROGRESS", error: "Still running." }, { status: 409 });
    await expect(accountCommandOutcomeUnknown(inProgress)).resolves.toBe(true);
    await expect(inProgress.json()).resolves.toMatchObject({
      error: "Still running.",
    });
    await expect(accountCommandOutcomeUnknown(new Response(null, { status: 408 }))).resolves.toBe(true);
    await expect(accountCommandOutcomeUnknown(new Response(null, { status: 503 }))).resolves.toBe(true);
    await expect(
      accountCommandOutcomeUnknown(Response.json({ code: "IDEMPOTENCY_CONFLICT" }, { status: 409 })),
    ).resolves.toBe(false);
  });

  it.each(["INVITATION_USED", "CONFLICT", "AUTHORITY_CHANGED", "IDEMPOTENCY_CONFLICT"])(
    "classifies the known terminal 409 code %s as final",
    async (code) => {
      await expect(accountCommandOutcomeUnknown(Response.json({ code }, { status: 409 }))).resolves.toBe(false);
    },
  );

  it("classifies unreadable and unrecognised 409 responses as unknown", async () => {
    const unreadable = {
      status: 409,
      clone: () => ({
        json: () => Promise.reject(new Error("response body disconnected")),
      }),
    } as unknown as Response;

    await expect(accountCommandOutcomeUnknown(new Response("truncated", { status: 409 }))).resolves.toBe(true);
    await expect(accountCommandOutcomeUnknown(unreadable)).resolves.toBe(true);
    await expect(
      accountCommandOutcomeUnknown(Response.json({ code: "FUTURE_CONFLICT_CODE" }, { status: 409 })),
    ).resolves.toBe(true);
  });
});
