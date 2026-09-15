import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { teamAccessClient } from "../../account/teamAccessClient";
import { useMemberInvites } from "./useMemberInvites";

describe("useMemberInvites schedule-person proposal", () => {
  afterEach(() => vi.restoreAllMocks());

  it("blocks a stale selected person after an eligibility refresh instead of omitting the proposal", async () => {
    const createInvitation = vi.spyOn(teamAccessClient, "createInvitation");
    const fail = vi.fn();
    const { result } = renderHook(() => useMemberInvites());
    act(() => result.current.setInvitationResourceId("person-stale"));
    const submit = result.current.createActions({
      authMode: "password",
      clear: vi.fn(),
      requestAccountId: () => "account-1",
      isActiveAccount: () => true,
      withMemberAction: async (_key, body) => body("account-1"),
      fail,
      setNotice: vi.fn(),
      reloadInvites: async () => {},
      reconcileUnknownMutation: async () => {},
      invitationPeople: [],
    }).submitInvite;

    await act(async () => submit());

    expect(fail).toHaveBeenCalledWith(
      "invite",
      "The selected person is no longer eligible. Choose another person before creating the invite.",
    );
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("clears a resource-first proposal when the established panel resets", () => {
    const { result } = renderHook(() => useMemberInvites("person-resource"));
    expect(result.current.invitationResourceId).toBe("person-resource");
    act(() => {
      result.current.setInviteRole("viewer");
      result.current.resetInviteDraft();
    });
    expect(result.current.invitationResourceId).toBe("");
    expect(result.current.inviteRole).toBe("editor");
  });

  it("clears the claimed draft when its account/session/auth context changes", async () => {
    const { result, rerender } = renderHook(({ contextKey }) => useMemberInvites("person-resource", contextKey), {
      initialProps: { contextKey: "account-1\u0000user-a\u00001\u0000password\u0000authorized\u0000online" },
    });
    act(() => {
      result.current.setInvitationPreauthorizedEmail("bruce@example.test");
      result.current.setInviteRole("viewer");
    });
    rerender({ contextKey: "account-1\u0000user-b\u00002\u0000sso\u0000unready\u0000offline" });
    await waitFor(() => expect(result.current.invitationResourceId).toBe(""));
    expect(result.current.invitationPreauthorizedEmail).toBe("");
    expect(result.current.inviteRole).toBe("editor");
  });
});
