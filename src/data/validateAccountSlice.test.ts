import { describe, expect, it } from "vitest";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { validateAccountSlice } from "./validateAccountSlice";

const accountId = "account-1";
const validSlice = () => ({
  ...emptyAppData(),
  accounts: [
    {
      id: accountId,
      name: "Studio",
      color: "#2d75da",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
});

describe("validateAccountSlice", () => {
  it("rejects missing, non-string, and duplicate ids before migration seeds a diff baseline", () => {
    expect(validateAccountSlice({ ...validSlice(), clients: [{ accountId }] }, accountId)).toBeNull();
    expect(validateAccountSlice({ ...validSlice(), clients: [{ id: 42, accountId }] }, accountId)).toBeNull();
    expect(
      validateAccountSlice(
        {
          ...validSlice(),
          clients: [
            { id: "duplicate", accountId },
            { id: "duplicate", accountId },
          ],
        },
        accountId,
      ),
    ).toBeNull();
  });

  it("accepts a complete unique-id slice", () => {
    expect(validateAccountSlice(validSlice(), accountId)?.accounts[0]?.id).toBe(accountId);
  });
});
