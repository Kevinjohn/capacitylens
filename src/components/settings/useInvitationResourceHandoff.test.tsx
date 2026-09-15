import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setInvitationPreselection, clearInvitationPreselection } from "./invitationPreselection";
import { useInvitationResourceHandoff } from "./useInvitationResourceHandoff";

const input = {
  activeAccountId: "account-1",
  authMode: "password" as const,
  directoryAuthorized: true,
  directoryContextKey: "authorized",
  directoryPending: false,
  enabled: true,
  offlineReadOnly: false,
  online: true,
  resetInviteDraft: vi.fn(),
  sessionInstanceId: "A".repeat(43),
  user: { id: "user-1" },
};

describe("useInvitationResourceHandoff directory boundary", () => {
  afterEach(() => clearInvitationPreselection());

  it("clears a claimed draft when the authoritative members read becomes forbidden", () => {
    setInvitationPreselection(
      {
        accountId: "account-1",
        userId: "user-1",
        sessionInstanceId: "A".repeat(43),
        authMode: "password",
        offlineReadOnly: false,
        online: true,
      },
      "person-1",
    );
    const { result, rerender } = renderHook((value) => useInvitationResourceHandoff(value), {
      initialProps: input,
    });
    expect(result.current).toBe("person-1");
    act(() => rerender({ ...input, directoryAuthorized: false }));
    expect(result.current).toBeNull();
    expect(input.resetInviteDraft).toHaveBeenCalled();
  });
});
