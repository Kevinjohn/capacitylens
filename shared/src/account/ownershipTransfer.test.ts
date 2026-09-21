import { describe, expect, it } from "vitest";
import {
  canTransitionOwnershipTransfer,
  isLiveOwnershipTransferState,
  isOwnershipTransferState,
  LIVE_OWNERSHIP_TRANSFER_STATES,
  nextOwnershipTransferState,
  OWNERSHIP_TRANSFER_ACTIONS,
  OWNERSHIP_TRANSFER_STATES,
  type OwnershipTransferAction,
  type OwnershipTransferState,
} from "./ownershipTransfer";

// The closed vocabularies. Written out rather than imported so the sweep is its own source of
// truth; the `satisfies` ties each list to its union, so a new member that is not listed here is a
// compile error and cannot escape the exhaustive matrix below.
const STATES = [
  "awaiting_target",
  "awaiting_owner",
  "declined",
  "cancelled",
  "expired",
  "invalidated",
  "completed",
] as const satisfies readonly OwnershipTransferState[];

const ACTIONS = [
  "initiate",
  "accept",
  "withdraw",
  "decline",
  "cancel",
  "complete",
] as const satisfies readonly OwnershipTransferAction[];

/** The whole state machine as a table, written from the product contract rather than derived from
 *  the implementation — a table derived from the code under test would agree with any bug in it. */
const EXPECTED: Record<OwnershipTransferState, Record<OwnershipTransferAction, boolean>> = {
  awaiting_target: {
    initiate: false,
    accept: true,
    withdraw: false,
    decline: true,
    cancel: true,
    complete: false,
  },
  awaiting_owner: {
    initiate: false,
    accept: false,
    withdraw: true,
    decline: false,
    cancel: true,
    complete: true,
  },
  declined: { initiate: false, accept: false, withdraw: false, decline: false, cancel: false, complete: false },
  cancelled: { initiate: false, accept: false, withdraw: false, decline: false, cancel: false, complete: false },
  expired: { initiate: false, accept: false, withdraw: false, decline: false, cancel: false, complete: false },
  invalidated: { initiate: false, accept: false, withdraw: false, decline: false, cancel: false, complete: false },
  completed: { initiate: false, accept: false, withdraw: false, decline: false, cancel: false, complete: false },
};

describe("ownership transfer state machine", () => {
  it("iterates exactly the state union (7 states, no more, no fewer)", () => {
    expect(STATES.length).toBe(7);
    expect(new Set(STATES).size).toBe(STATES.length);
    expect([...OWNERSHIP_TRANSFER_STATES]).toEqual([...STATES]);
  });

  it("iterates exactly the action union (6 actions, no more, no fewer)", () => {
    expect(ACTIONS.length).toBe(6);
    expect(new Set(ACTIONS).size).toBe(ACTIONS.length);
    expect([...OWNERSHIP_TRANSFER_ACTIONS]).toEqual([...ACTIONS]);
  });

  for (const state of STATES) {
    for (const action of ACTIONS) {
      const expected = EXPECTED[state][action];
      it(`canTransition('${state}', '${action}') === ${expected}`, () => {
        expect(canTransitionOwnershipTransfer(state, action)).toBe(expected);
      });
    }
  }

  it("treats exactly the two live states as live", () => {
    expect([...LIVE_OWNERSHIP_TRANSFER_STATES]).toEqual(["awaiting_target", "awaiting_owner"]);
    for (const state of STATES) {
      expect(isLiveOwnershipTransferState(state)).toBe(state === "awaiting_target" || state === "awaiting_owner");
    }
  });

  it("permits no transition at all out of any terminal state", () => {
    const terminal = STATES.filter((state) => !isLiveOwnershipTransferState(state));
    expect(terminal).toHaveLength(5);
    for (const state of terminal) {
      for (const action of ACTIONS) expect(canTransitionOwnershipTransfer(state, action)).toBe(false);
    }
  });

  it("never treats initiate as a transition — it creates a request rather than moving one", () => {
    for (const state of STATES) {
      expect(canTransitionOwnershipTransfer(state, "initiate")).toBe(false);
      expect(nextOwnershipTransferState(state, "initiate")).toBeNull();
    }
  });
});

describe("nextOwnershipTransferState", () => {
  it("routes each permitted edge to its destination", () => {
    expect(nextOwnershipTransferState("awaiting_target", "accept")).toBe("awaiting_owner");
    expect(nextOwnershipTransferState("awaiting_target", "decline")).toBe("declined");
    expect(nextOwnershipTransferState("awaiting_target", "cancel")).toBe("cancelled");
    expect(nextOwnershipTransferState("awaiting_owner", "complete")).toBe("completed");
    expect(nextOwnershipTransferState("awaiting_owner", "cancel")).toBe("cancelled");
  });

  // Withdrawal is the one edge that goes BACKWARDS, and it must not be confused with a decline:
  // the nominee may accept again, so the Owner's original nomination survives.
  it("returns withdrawal to awaiting_target rather than to a terminal state", () => {
    expect(nextOwnershipTransferState("awaiting_owner", "withdraw")).toBe("awaiting_target");
  });

  it("returns null for every edge the machine does not permit", () => {
    for (const state of STATES) {
      for (const action of ACTIONS) {
        if (EXPECTED[state][action]) continue;
        expect(nextOwnershipTransferState(state, action)).toBeNull();
      }
    }
  });
});

describe("isOwnershipTransferState", () => {
  it("accepts every member of the union", () => {
    for (const state of STATES) expect(isOwnershipTransferState(state)).toBe(true);
  });

  // Fail closed: an unknown persisted state must never be coerced into a live one, which would
  // hand a stale row the company's only live slot.
  it("rejects unknown values, near-misses and non-strings", () => {
    for (const value of ["", "AWAITING_TARGET", "awaiting", "pending", "active", 1, null, undefined, {}, []]) {
      expect(isOwnershipTransferState(value)).toBe(false);
    }
  });
});
