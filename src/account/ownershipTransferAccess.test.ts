import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiFetchReauth: vi
    .fn<(url: string, init?: RequestInit, timeout?: number) => Promise<Response>>()
    .mockResolvedValue(new Response(null, { status: 204 })),
}));

vi.mock("../data/apiConfig", () => ({ API_BASE: "https://app.example" }));
vi.mock("../data/requestTimeout", () => ({
  apiFetch: vi.fn(),
  API_BULK_TIMEOUT_MS: 120_000,
  createRequestSignal: vi.fn((signal?: AbortSignal) => signal),
}));
vi.mock("../auth/apiFetchReauth", () => ({
  apiFetchReauth: mocks.apiFetchReauth,
}));

import {
  accountClient,
  bindStoredAccountCommandsToIdentity,
  clearStoredAccountCommands,
  hasUnknownAccountCommandOutcome,
} from "./accountClient";
import { ownershipTransferAccess } from "./ownershipTransferAccess";

const command = { commandId: "command-1", idempotencyKey: "key-1" };

function commandHeadersAt(index: number): { commandId: string | null; idempotencyKey: string | null } {
  const init = mocks.apiFetchReauth.mock.calls[index]?.[1];
  if (!init) throw new Error(`Expected reauthenticated request call ${index} to include init options.`);
  const headers = new Headers(init.headers);
  return {
    commandId: headers.get("x-account-command-id"),
    idempotencyKey: headers.get("idempotency-key"),
  };
}

function terminalOwnershipTransferResponse(state = "expired"): Response {
  return Response.json({ code: "OWNERSHIP_TRANSFER_TERMINAL", state, reason: "deadline_passed" }, { status: 409 });
}

describe("ownership transfer access", () => {
  beforeEach(() => {
    clearStoredAccountCommands();
    mocks.apiFetchReauth.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["awaiting_target", "awaiting_owner"])(
    "rejects a purported terminal response whose transfer remains in live state %s",
    async (state) => {
      mocks.apiFetchReauth.mockResolvedValueOnce(terminalOwnershipTransferResponse(state));

      await expect(
        ownershipTransferAccess.initiateOwnershipTransfer({
          workspaceId: "wayne-enterprises",
          targetPrincipalId: "dick-grayson",
        }),
      ).resolves.toMatchObject({ kind: "unknown", status: 409 });
    },
  );

  it("closes a committed terminal initiation and starts the same transfer with fresh identities", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000101")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000102")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000103")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000104");
    const firstResponse = terminalOwnershipTransferResponse();
    mocks.apiFetchReauth
      .mockImplementationOnce(() => Promise.resolve(firstResponse))
      .mockImplementationOnce(() => Promise.resolve(terminalOwnershipTransferResponse()));
    bindStoredAccountCommandsToIdentity("bruce-wayne");
    const input = { workspaceId: "wayne-enterprises", targetPrincipalId: "dick-grayson" };

    const first = await ownershipTransferAccess.initiateOwnershipTransfer(input);
    expect(first).toEqual({
      kind: "ok",
      status: 409,
      value: { kind: "terminal", state: "expired", reason: "deadline_passed" },
    });
    expect(hasUnknownAccountCommandOutcome(firstResponse)).toBe(false);
    expect(
      sessionStorage.getItem(
        "capacitylens.account-command.bruce-wayne.ownership-transfer:initiate:wayne-enterprises:dick-grayson",
      ),
    ).toBeNull();

    await ownershipTransferAccess.initiateOwnershipTransfer(input);

    expect(commandHeadersAt(0)).toEqual({
      commandId: "00000000-0000-4000-8000-000000000101",
      idempotencyKey: "00000000-0000-4000-8000-000000000102",
    });
    expect(commandHeadersAt(1)).toEqual({
      commandId: "00000000-0000-4000-8000-000000000103",
      idempotencyKey: "00000000-0000-4000-8000-000000000104",
    });
  });

  it("retains a 503 identity through a terminal retry, then creates a fresh initiation", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000111")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000112")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000113")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000114");
    mocks.apiFetchReauth
      .mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 503 })))
      .mockImplementationOnce(() => Promise.resolve(terminalOwnershipTransferResponse("invalidated")))
      .mockImplementationOnce(() => Promise.resolve(terminalOwnershipTransferResponse("completed")));
    const input = { workspaceId: "wayne-enterprises", targetPrincipalId: "dick-grayson" };

    await ownershipTransferAccess.initiateOwnershipTransfer(input);
    const terminal = await ownershipTransferAccess.initiateOwnershipTransfer(input);
    await ownershipTransferAccess.initiateOwnershipTransfer(input);

    expect(terminal).toMatchObject({ kind: "ok", value: { kind: "terminal", state: "invalidated" } });
    expect(commandHeadersAt(0)).toEqual(commandHeadersAt(1));
    expect(commandHeadersAt(2)).toEqual({
      commandId: "00000000-0000-4000-8000-000000000113",
      idempotencyKey: "00000000-0000-4000-8000-000000000114",
    });
  });

  it("rotates the memory fallback after a committed terminal result", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000121")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000122")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000123")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000124");
    mocks.apiFetchReauth
      .mockImplementationOnce(() => Promise.resolve(terminalOwnershipTransferResponse()))
      .mockImplementationOnce(() => Promise.resolve(terminalOwnershipTransferResponse()));
    bindStoredAccountCommandsToIdentity("bruce-wayne");
    const input = { workspaceId: "wayne-enterprises", targetPrincipalId: "dick-grayson" };

    await ownershipTransferAccess.initiateOwnershipTransfer(input);
    await ownershipTransferAccess.initiateOwnershipTransfer(input);

    expect(commandHeadersAt(0)).not.toEqual(commandHeadersAt(1));
  });

  it("does not let a terminal explicit ceremony command clear an implicit recovery handle", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000131")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000132");
    mocks.apiFetchReauth
      .mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 503 })))
      .mockImplementationOnce(() => Promise.resolve(terminalOwnershipTransferResponse()))
      .mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 503 })));
    const input = {
      workspaceId: "wayne-enterprises",
      requestId: "transfer-one",
      step: "accept" as const,
      expectedRevision: "0",
    };

    await accountClient.commandOwnershipTransfer(input);
    await accountClient.commandOwnershipTransfer({ ...input, command });
    await accountClient.commandOwnershipTransfer(input);

    expect(commandHeadersAt(0)).toEqual(commandHeadersAt(2));
    expect(commandHeadersAt(1)).toEqual({ commandId: command.commandId, idempotencyKey: command.idempotencyKey });
  });

  // Locks in the current (post-fix) behavior on purpose: the released retry handle means an
  // identical retry after a terminal 409 mints a fresh command and is answered with a generic
  // conflict, not a replay of the earlier terminal receipt. This is a known, accepted trade-off of
  // releasing the handle (see the review discussion on #908), not a guarantee to improve here.
  it("mints a fresh command and receives a generic conflict on retry after a row command's terminal outcome", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000141")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000142")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000143")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000144");
    mocks.apiFetchReauth
      .mockImplementationOnce(() => Promise.resolve(terminalOwnershipTransferResponse("expired")))
      .mockImplementationOnce(() => Promise.resolve(Response.json({ code: "CONFLICT" }, { status: 409 })));
    bindStoredAccountCommandsToIdentity("bruce-wayne");
    const input = {
      workspaceId: "wayne-enterprises",
      requestId: "transfer-one",
      step: "accept" as const,
      expectedRevision: "0",
    };

    const first = await ownershipTransferAccess.commandOwnershipTransfer(input);
    expect(first).toMatchObject({ kind: "ok", value: { kind: "terminal", state: "expired" } });

    const retry = await ownershipTransferAccess.commandOwnershipTransfer(input);

    expect(retry).toMatchObject({ kind: "rejected", status: 409 });
    expect(commandHeadersAt(0)).not.toEqual(commandHeadersAt(1));
  });
});
