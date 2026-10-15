import { beforeEach, describe, expect, it, vi } from "vitest";

const accountClient = vi.hoisted(() => ({ transferOwnership: vi.fn() }));
vi.mock("./accountClient", () => ({ accountClient }));

import { ownershipTransferAccess } from "./ownershipTransferAccess";

describe("ownership transfer access", () => {
  beforeEach(() => accountClient.transferOwnership.mockReset());

  it("accepts only the two-ID receipt returned after the immediate role swap", async () => {
    accountClient.transferOwnership.mockResolvedValue(Response.json({ fromUserId: "bruce", toUserId: "selina" }));

    await expect(
      ownershipTransferAccess.transferOwnership({
        workspaceId: "wayne-enterprises",
        targetPrincipalId: "selina",
      }),
    ).resolves.toEqual({
      kind: "ok",
      status: 200,
      value: { fromUserId: "bruce", toUserId: "selina" },
    });
  });

  it("treats a malformed receipt as uncertain instead of claiming the transfer failed", async () => {
    accountClient.transferOwnership.mockResolvedValue(Response.json({ state: "awaiting_target" }));

    await expect(
      ownershipTransferAccess.transferOwnership({
        workspaceId: "wayne-enterprises",
        targetPrincipalId: "selina",
      }),
    ).resolves.toMatchObject({ kind: "invalid", status: 200 });
  });
});
