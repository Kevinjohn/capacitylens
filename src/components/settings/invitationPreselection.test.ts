import { afterEach, describe, expect, it } from "vitest";
import {
  clearInvitationPreselection,
  setInvitationPreselection,
  takeInvitationPreselection,
} from "./invitationPreselection";

describe("invitation preselection handoff", () => {
  afterEach(() => clearInvitationPreselection());

  it("is one-shot and scoped to account plus authenticated session", () => {
    setInvitationPreselection("account-1", "user-1", "person-1");
    expect(takeInvitationPreselection("account-2", "user-1")).toBeNull();
    expect(takeInvitationPreselection("account-1", "user-2")).toBeNull();
    expect(takeInvitationPreselection("account-1", "user-1")).toBe("person-1");
    expect(takeInvitationPreselection("account-1", "user-1")).toBeNull();
  });
});
