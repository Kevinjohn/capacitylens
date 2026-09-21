import { describe, expect, it } from "vitest";
import { OWNERSHIP_TRANSFER_ACTIONS, type OwnershipTransferAction } from "./ownershipTransfer";
import {
  canActOnOwnershipTransfer,
  canReadOwnershipTransfer,
  isOwnershipTransferExpired,
  OWNERSHIP_TRANSFER_HISTORY_RETENTION_MS,
  OWNERSHIP_TRANSFER_TTL_MS,
} from "./ownershipTransferPolicy";
import { ACCOUNT_ROLES, type Role } from "./types";

const ROLES: readonly Role[] = ACCOUNT_ROLES;

/** Every standing a caller can hold relative to one request. A caller cannot be both participants:
 *  the table forbids equal ids, so that combination is not modelled. */
const STANDINGS = [
  { label: "initiator", isInitiator: true, isTarget: false },
  { label: "target", isInitiator: false, isTarget: true },
  { label: "bystander", isInitiator: false, isTarget: false },
] as const;

/**
 * The authorisation matrix, written from the product contract.
 *
 * The rows that matter most are the Admin ones: `admin/target` may accept, withdraw and decline,
 * and `admin/bystander` may do NOTHING. If tier alone decided, those two rows would be identical —
 * and every Admin in the company could consent on the nominee's behalf, which is the exact consent
 * the ceremony exists to obtain.
 */
function expected(
  action: OwnershipTransferAction,
  { role, isInitiator, isTarget }: { role: Role; isInitiator: boolean; isTarget: boolean },
): boolean {
  switch (action) {
    case "initiate":
      return role === "owner";
    case "cancel":
    case "complete":
      return role === "owner" && isInitiator;
    case "accept":
    case "withdraw":
    case "decline":
      return role === "admin" && isTarget;
  }
}

describe("canActOnOwnershipTransfer", () => {
  for (const action of OWNERSHIP_TRANSFER_ACTIONS) {
    for (const role of ROLES) {
      for (const { label, isInitiator, isTarget } of STANDINGS) {
        const want = expected(action, { role, isInitiator, isTarget });
        it(`${role}/${label} ${want ? "may" : "may not"} ${action}`, () => {
          expect(canActOnOwnershipTransfer(action, { callerRole: role, isInitiator, isTarget })).toBe(want);
        });
      }
    }
  }

  it("lets no Admin who is not the nominee consent on their behalf", () => {
    for (const action of ["accept", "withdraw", "decline"] as const) {
      expect(canActOnOwnershipTransfer(action, { callerRole: "admin", isInitiator: false, isTarget: false })).toBe(
        false,
      );
    }
  });

  // The Owner is above Admin in every other threshold in the product; here they are deliberately
  // NOT, because consent that the Owner can give themselves is not consent.
  it("does not let the Owner accept, withdraw or decline on the nominee's behalf", () => {
    for (const action of ["accept", "withdraw", "decline"] as const) {
      for (const { isInitiator, isTarget } of STANDINGS) {
        expect(canActOnOwnershipTransfer(action, { callerRole: "owner", isInitiator, isTarget })).toBe(false);
      }
    }
  });

  it("does not let a former Owner who is now an Admin cancel or complete their own request", () => {
    for (const action of ["cancel", "complete"] as const) {
      expect(canActOnOwnershipTransfer(action, { callerRole: "admin", isInitiator: true, isTarget: false })).toBe(
        false,
      );
    }
  });

  // A nominee promoted or demoted since nomination is no longer the person whose consent was
  // sought, so the exact-role requirement is load-bearing rather than a tier shorthand.
  it("requires the nominee's role to be exactly admin", () => {
    for (const role of ROLES) {
      expect(canActOnOwnershipTransfer("accept", { callerRole: role, isInitiator: false, isTarget: true })).toBe(
        role === "admin",
      );
    }
  });
});

describe("canReadOwnershipTransfer", () => {
  it("admits both participants and nobody else", () => {
    expect(canReadOwnershipTransfer({ isInitiator: true, isTarget: false })).toBe(true);
    expect(canReadOwnershipTransfer({ isInitiator: false, isTarget: true })).toBe(true);
    expect(canReadOwnershipTransfer({ isInitiator: false, isTarget: false })).toBe(false);
  });
});

describe("isOwnershipTransferExpired", () => {
  const deadline = "2026-09-18T12:00:00.000Z";
  const deadlineMs = Date.parse(deadline);

  it("is live strictly before the deadline and expired from the deadline instant onwards", () => {
    expect(isOwnershipTransferExpired(deadline, deadlineMs - 1)).toBe(false);
    expect(isOwnershipTransferExpired(deadline, deadlineMs)).toBe(true);
    expect(isOwnershipTransferExpired(deadline, deadlineMs + 1)).toBe(true);
  });

  it("treats an unreadable deadline as passed rather than as live", () => {
    // The last two are shapes `Date.parse` would happily accept: the deadline is read with the
    // repository's strict ISO parser, so anything that is not a real ISO instant fails closed.
    for (const value of ["", "not-a-date", "2026-13-45T99:99:99Z", "2026-09-18 12:00:00", "Sep 18 2026"]) {
      expect(isOwnershipTransferExpired(value, deadlineMs)).toBe(true);
    }
  });
});

describe("policy constants", () => {
  it("opens a nomination for seven days", () => {
    expect(OWNERSHIP_TRANSFER_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("retains a terminal outcome for a year", () => {
    expect(OWNERSHIP_TRANSFER_HISTORY_RETENTION_MS).toBe(365 * 24 * 60 * 60 * 1000);
  });

  // The two are independent policies and the retention one must outlive the ceremony itself,
  // otherwise a request could be swept while it was still open.
  it("retains an outcome for longer than a nomination can stay open", () => {
    expect(OWNERSHIP_TRANSFER_HISTORY_RETENTION_MS).toBeGreaterThan(OWNERSHIP_TRANSFER_TTL_MS);
  });
});
