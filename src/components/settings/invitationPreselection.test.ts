import { renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimInvitationPreselection,
  clearInvitationPreselection,
  peekInvitationPreselection,
  setInvitationPreselection,
  useInvitationPreselectionLifecycle,
} from "./invitationPreselection";

const context = (overrides: Partial<Parameters<typeof setInvitationPreselection>[0]> = {}) => ({
  accountId: "account-1",
  userId: "user-1",
  sessionInstanceId: "A".repeat(43),
  authMode: "password" as const,
  offlineReadOnly: false,
  online: true,
  ...overrides,
});

describe("invitation preselection handoff", () => {
  afterEach(() => clearInvitationPreselection());

  it("is one-shot and scoped to account plus authenticated session", () => {
    const current = context();
    setInvitationPreselection(current, "person-1");
    expect(peekInvitationPreselection(current)).toBe("person-1");
    expect(peekInvitationPreselection(context({ accountId: "account-2" }))).toBeNull();
    expect(claimInvitationPreselection(context({ userId: "user-2" }))).toBeNull();
    expect(claimInvitationPreselection(context({ accountId: "account-2" }))).toBeNull();
    setInvitationPreselection(current, "person-1");
    expect(claimInvitationPreselection(current)).toBe("person-1");
    expect(claimInvitationPreselection(current)).toBeNull();
  });

  it("treats a renewed identity, auth mode, or connectivity as a mismatch", () => {
    const current = context();
    for (const mismatch of [
      { sessionInstanceId: "B".repeat(43) },
      { sessionInstanceId: null },
      { authMode: "sso" as const },
      { offlineReadOnly: true },
      { online: false },
    ]) {
      setInvitationPreselection(current, "person-1");
      expect(claimInvitationPreselection(context(mismatch))).toBeNull();
      expect(peekInvitationPreselection(current)).toBeNull();
    }
  });

  it("clears on gated context loss and cannot restore after switching away and back", async () => {
    const current = context();
    setInvitationPreselection(current, "person-1");
    type Lifecycle = Parameters<typeof useInvitationPreselectionLifecycle>[0];
    const { rerender, unmount } = renderHook<void, { lifecycle: Lifecycle }>(
      ({ lifecycle }: { lifecycle: Parameters<typeof useInvitationPreselectionLifecycle>[0] }) =>
        useInvitationPreselectionLifecycle(lifecycle),
      {
        initialProps: {
          lifecycle: {
            ...current,
            permissionStatus: "pending" as "pending" | "resolved",
            mayManage: false,
          },
        },
        wrapper: StrictMode,
      },
    );
    rerender({
      lifecycle: {
        ...current,
        userId: "user-2",
        sessionInstanceId: "B".repeat(43),
        permissionStatus: "resolved",
        mayManage: false,
      },
    });
    rerender({
      lifecycle: {
        ...current,
        permissionStatus: "resolved",
        mayManage: true,
      },
    });
    await waitFor(() => expect(claimInvitationPreselection(current)).toBeNull());
    setInvitationPreselection(current, "person-1");
    rerender({
      lifecycle: {
        ...current,
        online: false,
        permissionStatus: "resolved",
        mayManage: true,
      },
    });
    await waitFor(() => expect(peekInvitationPreselection(current)).toBeNull());
    unmount();
  });
});
