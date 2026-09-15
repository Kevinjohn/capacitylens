import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { teamAccessClient } from "../../account/teamAccessClient";
import { useMemberResourceLinkMutation } from "./useMemberResourceLinkMutation";

const input = { principalId: "user-1", resourceId: "person-1", expectedRevision: null };

describe("useMemberResourceLinkMutation", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    { kind: "rejected", status: 409, message: "conflict" },
    { kind: "unknown", status: 0, message: null },
    { kind: "invalid", status: 200, message: "bad response" },
  ] as const)("reconciles a $kind association outcome before retry", async (result) => {
    vi.spyOn(teamAccessClient, "setMemberResourceLink").mockResolvedValue(result as never);
    const reload = vi.fn();
    const reconcile = vi.fn().mockResolvedValue(true);
    const { result: hook } = renderHook(() =>
      useMemberResourceLinkMutation({ workspaceId: "account-1", contextKey: "account-1:user-1", reload, reconcile }),
    );

    await act(async () => hook.current.mutate(input));

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(hook.current.error).toBeTruthy();
  });

  it("reconciles thrown transport outcomes and preserves the uncertain classification", async () => {
    vi.spyOn(teamAccessClient, "setMemberResourceLink").mockRejectedValue(new Error("network down"));
    const reload = vi.fn();
    const reconcile = vi.fn().mockResolvedValue(true);
    const { result: hook } = renderHook(() =>
      useMemberResourceLinkMutation({ workspaceId: "account-1", contextKey: "account-1:user-1", reload, reconcile }),
    );

    let outcome: { kind: string } | undefined;
    await act(async () => {
      outcome = await hook.current.mutate(input);
    });

    expect(outcome?.kind).toBe("unknown");
    expect(reconcile).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("invalidates capability and feedback globally on a 403", async () => {
    vi.spyOn(teamAccessClient, "setMemberResourceLink").mockResolvedValue({
      kind: "rejected",
      status: 403,
      message: null,
    });
    const onForbidden = vi.fn();
    const reconcile = vi.fn();
    const { result: hook } = renderHook(() =>
      useMemberResourceLinkMutation({
        workspaceId: "account-1",
        contextKey: "account-1:user-1",
        reload: vi.fn(),
        reconcile,
        onForbidden,
      }),
    );

    await act(async () => hook.current.mutate(input));

    expect(onForbidden).toHaveBeenCalledWith(expect.any(String));
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("suppresses an old response after an account/session generation changes", async () => {
    let resolve: ((value: never) => void) | undefined;
    vi.spyOn(teamAccessClient, "setMemberResourceLink").mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const reload = vi.fn();
    const { result: hook, rerender } = renderHook(
      ({ contextKey }) => useMemberResourceLinkMutation({ workspaceId: "account-1", contextKey, reload }),
      { initialProps: { contextKey: "account-1:user-1" } },
    );

    let pending: Promise<unknown> | undefined;
    await act(async () => {
      pending = hook.current.mutate(input);
    });
    rerender({ contextKey: "account-2:user-2" });
    resolve?.({ kind: "ok", status: 200, value: { resourceId: "person-1", revision: "2" } } as never);
    await act(async () => pending);

    expect(reload).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "unknown", status: 0, message: null },
    { kind: "rejected", status: 403, message: null },
  ] as const)("uses the distinct exception dismissal command for $kind", async (response) => {
    const dismiss = vi
      .spyOn(teamAccessClient, "dismissMemberResourceLinkException")
      .mockResolvedValue(response as never);
    const onForbidden = vi.fn();
    const reconcile = vi.fn().mockResolvedValue(true);
    const reload = vi.fn();
    const { result: hook } = renderHook(() =>
      useMemberResourceLinkMutation({
        workspaceId: "account-1",
        contextKey: "account-1:user-1",
        reload,
        reconcile,
        onForbidden,
      }),
    );

    await act(async () => hook.current.dismiss("user-1"));

    expect(dismiss).toHaveBeenCalledWith("account-1", "user-1");
    if (response.kind === "unknown") expect(reconcile).toHaveBeenCalledOnce();
    else expect(onForbidden).toHaveBeenCalledOnce();
  });

  it("reconciles a thrown exception dismissal outcome", async () => {
    vi.spyOn(teamAccessClient, "dismissMemberResourceLinkException").mockRejectedValue(new Error("offline"));
    const reconcile = vi.fn().mockResolvedValue(true);
    const { result: hook } = renderHook(() =>
      useMemberResourceLinkMutation({
        workspaceId: "account-1",
        contextKey: "account-1:user-1",
        reload: vi.fn(),
        reconcile,
      }),
    );

    let outcome: { kind: string } | undefined;
    await act(async () => {
      outcome = await hook.current.dismiss("user-1");
    });
    expect(reconcile).toHaveBeenCalledOnce();
    expect(outcome?.kind).toBe("unknown");
    expect(hook.current.error).toContain("could not be changed");
  });
});
