import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { Resource } from "@capacitylens/shared/types/entities";
import { afterEach, describe, expect, it, vi } from "vitest";
import { teamAccessClient } from "../../account/teamAccessClient";
import { useStore } from "../../store/useStore";
import { ResourceMemberActions, useResourceMemberActionsModel } from "./ResourceMemberActions";

const person = {
  id: "person-1",
  accountId: "account-1",
  kind: "person",
  name: "Bruce Wayne",
  role: "Developer",
  employmentType: "permanent",
  engagement: "studio",
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: "#3b82f6",
} as unknown as Resource;

const auth = vi.hoisted(() => ({
  mode: "password" as "off" | "password",
  user: { id: "user-1" } as { id: string } | null,
  sessionInstanceId: "A".repeat(43) as string | null,
}));
const offline = vi.hoisted(() => ({ readOnly: false }));
vi.mock("../../auth/authContext", () => ({
  useAuth: () => ({ authMode: auth.mode, user: auth.user, sessionInstanceId: auth.sessionInstanceId }),
}));
vi.mock("../../data/apiConfig", () => ({ isServerConfigured: () => true }));
vi.mock("../../data/useOfflineState", () => ({ useOfflineState: () => offline }));

describe("useResourceMemberActionsModel authorization boundary", () => {
  afterEach(() => {
    auth.mode = "password";
    auth.user = { id: "user-1" };
    auth.sessionInstanceId = "A".repeat(43);
    offline.readOnly = false;
    vi.restoreAllMocks();
  });

  it("loads the narrow directory for an active Admin", async () => {
    useStore.setState({ accountSummaries: [{ id: "account-1", role: "admin", roleStatus: "resolved" }] } as never);
    const listMembers = vi.spyOn(teamAccessClient, "listMembers").mockResolvedValue({
      kind: "ok",
      status: 200,
      value: {
        members: [
          {
            userId: "user-1",
            role: "admin",
            status: "active",
            createdAt: "2026-01-01T00:00:00.000Z",
            name: "Bruce Wayne",
            email: "bruce@example.test",
            signInConfirmed: null,
            isSelf: true,
            mayResetPassword: false,
            mayRevokeSessions: false,
            resourceLink: null,
            resourceLinkException: null,
          },
        ],
        signInTrackingEnabled: false,
        resourceCandidates: [],
      },
    });
    const { result } = renderHook(() => useResourceMemberActionsModel("account-1"));
    await waitFor(() => expect(result.current.canManage).toBe(true));
    expect(listMembers).toHaveBeenCalledOnce();
  });

  it("invalidates the global capability and suppresses stale rereads after a directory 403", async () => {
    useStore.setState({ accountSummaries: [{ id: "account-1", role: "admin", roleStatus: "resolved" }] } as never);
    const listMembers = vi.spyOn(teamAccessClient, "listMembers").mockResolvedValue({
      kind: "rejected",
      status: 403,
      message: "forbidden",
    });
    const setNotice = vi.spyOn(useStore.getState(), "setNotice");
    const { result } = renderHook(() => useResourceMemberActionsModel("account-1"));
    await waitFor(() => expect(result.current.directoryError).toBeTruthy());
    expect(result.current.canManage).toBe(false);
    expect(listMembers).toHaveBeenCalledOnce();
    expect(setNotice).toHaveBeenCalledWith(expect.stringMatching(/member management changed/i), "error");
    useStore.getState().invalidateMemberships();
    await waitFor(() => expect(result.current.canManage).toBe(false));
    expect(listMembers).toHaveBeenCalledOnce();
  });

  it("forgets a forbidden latch when the user or browser leaves and returns to its context", async () => {
    useStore.setState({ accountSummaries: [{ id: "account-1", role: "admin", roleStatus: "resolved" }] } as never);
    const listMembers = vi.spyOn(teamAccessClient, "listMembers").mockResolvedValue({
      kind: "rejected",
      status: 403,
      message: "forbidden",
    });
    const { result, rerender } = renderHook(() => useResourceMemberActionsModel("account-1"));
    await waitFor(() => expect(result.current.directoryError).toBeTruthy());
    expect(listMembers).toHaveBeenCalledOnce();

    auth.user = { id: "user-2" };
    rerender();
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(2));
    auth.user = { id: "user-1" };
    rerender();
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(3));
  });

  it("drops and refreshes the projection across navigator offline and online transitions", async () => {
    useStore.setState({ accountSummaries: [{ id: "account-1", role: "admin", roleStatus: "resolved" }] } as never);
    const listMembers = vi.spyOn(teamAccessClient, "listMembers").mockResolvedValue({
      kind: "ok",
      status: 200,
      value: {
        members: [
          {
            userId: "user-1",
            role: "admin",
            status: "active",
            createdAt: "2026-01-01T00:00:00.000Z",
            name: "Bruce Wayne",
            email: "bruce@example.test",
            signInConfirmed: null,
            isSelf: true,
            mayResetPassword: false,
            mayRevokeSessions: false,
            resourceLink: null,
            resourceLinkException: null,
          },
        ],
        signInTrackingEnabled: false,
        resourceCandidates: [],
      },
    });
    const originalOnline = navigator.onLine;
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const { result } = renderHook(() => useResourceMemberActionsModel("account-1"));
    await waitFor(() => expect(result.current.canManage).toBe(true));
    expect(listMembers).toHaveBeenCalledOnce();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    window.dispatchEvent(new Event("offline"));
    await waitFor(() => expect(result.current.canManage).toBe(false));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(2));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: originalOnline });
  });

  it("clears the candidate projection on a same-user session-handle change", async () => {
    useStore.setState({ accountSummaries: [{ id: "account-1", role: "admin", roleStatus: "resolved" }] } as never);
    const listMembers = vi.spyOn(teamAccessClient, "listMembers").mockResolvedValue({
      kind: "ok",
      status: 200,
      value: {
        members: [
          {
            userId: "user-1",
            role: "admin",
            status: "active",
            createdAt: "2026-01-01T00:00:00.000Z",
            name: "Bruce Wayne",
            email: "bruce@example.test",
            signInConfirmed: null,
            isSelf: true,
            mayResetPassword: false,
            mayRevokeSessions: false,
            resourceLink: null,
            resourceLinkException: null,
          },
        ],
        signInTrackingEnabled: false,
        resourceCandidates: [{ resourceId: "person-1", label: "Bruce Wayne" }],
      },
    });
    const { result, rerender } = renderHook(() => useResourceMemberActionsModel("account-1"));
    await waitFor(() => expect(result.current.canManage).toBe(true));
    expect(result.current.members).toHaveLength(1);
    auth.sessionInstanceId = "B".repeat(43);
    rerender();
    expect(result.current.canManage).toBe(false);
    expect(result.current.members).toEqual([]);
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(2));
  });

  it("preserves the directory and open link dialog for a fresh equivalent user object", async () => {
    useStore.setState({ accountSummaries: [{ id: "account-1", role: "admin", roleStatus: "resolved" }] } as never);
    const listMembers = vi.spyOn(teamAccessClient, "listMembers").mockResolvedValue({
      kind: "ok",
      status: 200,
      value: {
        members: [
          {
            userId: "user-1",
            role: "admin",
            status: "active",
            createdAt: "2026-01-01T00:00:00.000Z",
            name: "Bruce Wayne",
            email: "bruce@example.test",
            signInConfirmed: null,
            isSelf: true,
            mayResetPassword: false,
            mayRevokeSessions: false,
            resourceLink: null,
            resourceLinkException: null,
          },
        ],
        signInTrackingEnabled: false,
        resourceCandidates: [{ resourceId: "person-1", label: "Bruce Wayne" }],
      },
    });
    const modelHook = renderHook(() => useResourceMemberActionsModel("account-1"));
    await waitFor(() => expect(modelHook.result.current.canManage).toBe(true));
    const view = render(
      <ResourceMemberActions resource={person} accountId="account-1" model={modelHook.result.current} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Link existing member Bruce Wayne/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    auth.user = { id: "user-1" };
    modelHook.rerender();
    view.rerender(<ResourceMemberActions resource={person} accountId="account-1" model={modelHook.result.current} />);
    expect(listMembers).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    view.unmount();
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
    [
      "legacy session without a handle",
      () => {
        auth.sessionInstanceId = null;
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
