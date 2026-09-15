import { afterEach, describe, expect, it } from "vitest";
import {
  claimInvitationPreselection,
  clearInvitationPreselection,
  peekInvitationPreselection,
  setInvitationPreselection,
} from "./invitationPreselection";

describe("invitation preselection handoff", () => {
  afterEach(() => clearInvitationPreselection());

  it("is one-shot and scoped to account plus authenticated session", () => {
    setInvitationPreselection("account-1", "user-1", "person-1");
    expect(peekInvitationPreselection("account-1", "user-1")).toBe("person-1");
    expect(peekInvitationPreselection("account-2", "user-1")).toBeNull();
    expect(claimInvitationPreselection("account-1", "user-2")).toBeNull();
    expect(claimInvitationPreselection("account-2", "user-1")).toBeNull();
    setInvitationPreselection("account-1", "user-1", "person-1");
    expect(claimInvitationPreselection("account-1", "user-1")).toBe("person-1");
    expect(claimInvitationPreselection("account-1", "user-1")).toBeNull();
  });
});
