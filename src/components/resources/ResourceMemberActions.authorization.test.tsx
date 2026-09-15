import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { teamAccessClient } from "../../account/teamAccessClient";
import { useStore } from "../../store/useStore";
import { useResourceMemberActionsModel } from "./ResourceMemberActions";

const auth = vi.hoisted(() => ({
  mode: "password" as "off" | "password",
  user: { id: "user-1" } as { id: string } | null,
}));
const offline = vi.hoisted(() => ({ readOnly: false }));
vi.mock("../../auth/authContext", () => ({ useAuth: () => ({ authMode: auth.mode, user: auth.user }) }));
vi.mock("../../data/apiConfig", () => ({ isServerConfigured: () => true }));
vi.mock("../../data/useOfflineState", () => ({ useOfflineState: () => offline }));

describe("useResourceMemberActionsModel authorization boundary", () => {
  afterEach(() => {
    auth.mode = "password";
    auth.user = { id: "user-1" };
    offline.readOnly = false;
    vi.restoreAllMocks();
  });

  it.each([
    ["editor", "resolved"],
    ["viewer", "resolved"],
    ["owner", "unavailable"],
  ] as const)("does not issue an admin directory read for %s/%s", async (role, roleStatus) => {
    useStore.setState({ accountSummaries: [{ id: "account-1", role, roleStatus }] } as never);
    const listMembers = vi.spyOn(teamAccessClient, "listMembers");
    const { result } = renderHook(() => useResourceMemberActionsModel("account-1"));
    await waitFor(() => expect(result.current.canManage).toBe(false));
    expect(listMembers).not.toHaveBeenCalled();
  });

  it.each([
    [
      "auth off",
      () => {
        auth.mode = "off";
      },
    ],
    [
      "offline",
      () => {
        offline.readOnly = true;
      },
    ],
    [
      "unresolved session",
      () => {
        auth.user = null;
      },
    ],
  ] as const)("fails closed and suppresses reads in %s mode", async (_label, change) => {
    change();
    useStore.setState({ accountSummaries: [{ id: "account-1", role: "owner", roleStatus: "resolved" }] } as never);
    const listMembers = vi.spyOn(teamAccessClient, "listMembers");
    const { result } = renderHook(() => useResourceMemberActionsModel("account-1"));
    await waitFor(() => expect(result.current.canManage).toBe(false));
    expect(listMembers).not.toHaveBeenCalled();
  });
});
