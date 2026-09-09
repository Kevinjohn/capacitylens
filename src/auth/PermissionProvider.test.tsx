import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { PermissionProvider } from "./PermissionProvider";
import { AuthContext, type AuthContextValue } from "./authContext";
import { useCanEdit, usePermissionStatus, useRole } from "./permissionContext";
import { makeAccount, makeAppData, resetStoreWithAccount } from "../test/fixtures";
import { useStore } from "../store/useStore";
import { setOfflineReadState } from "../data/offlineCache";
import { useAccountSummaries } from "./useAccountSummaries";
import { masqueradeController } from "./masqueradeController";

const permissionMocks = vi.hoisted(() => ({
  masqueradeStatus: vi.fn(async () => ({ active: false as const })),
}));
vi.mock("./masqueradeApi", () => ({
  masqueradeApi: { status: permissionMocks.masqueradeStatus },
}));

const auth: AuthContextValue = {
  authMode: "password",
  user: { id: "u1" },
  canCreateAccount: false,
  multiAccount: false,
  refreshAuth: async () => {},
  signOut: async () => {},
};

function Probe() {
  const role = useRole();
  const status = usePermissionStatus();
  const editable = useCanEdit();
  return <div>{`${status}:${role ?? "none"}:${editable ? "edit" : "read"}`}</div>;
}

function renderProvider() {
  return render(
    <AuthContext.Provider value={auth}>
      <PermissionProvider>
        <Probe />
      </PermissionProvider>
    </AuthContext.Provider>,
  );
}

function SharedDirectoryProvider() {
  useAccountSummaries({ refreshActiveAccount: false });
  return (
    <PermissionProvider>
      <Probe />
    </PermissionProvider>
  );
}

function renderSharedDirectoryProvider() {
  return render(
    <AuthContext.Provider value={auth}>
      <SharedDirectoryProvider />
    </AuthContext.Provider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function accountResponse(id: string, role: string) {
  return new Response(
    JSON.stringify([{ id, name: id === "a-studio" ? "Wayne Enterprises" : "Stark Industries", role }]),
    {
      status: 200,
    },
  );
}

function addSecondAccount() {
  useStore.getState().replaceAll(
    makeAppData({
      accounts: [makeAccount({ id: "acct-test" }), makeAccount({ id: "a-studio", name: "Wayne Enterprises" })],
    }),
  );
  useStore.getState().setActiveAccount("acct-test");
}

beforeEach(() => {
  permissionMocks.masqueradeStatus.mockReset().mockResolvedValue({ active: false });
  resetStoreWithAccount();
  setOfflineReadState("cleanup", false);
  vi.stubEnv("VITE_CAPACITYLENS_DEMO", "");
});

afterEach(() => {
  setOfflineReadState("cleanup", false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("PermissionProvider authenticated lookup posture", () => {
  it("is read-only immediately while role lookup is pending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    renderProvider();

    expect(screen.getByText("pending:viewer:read")).toBeInTheDocument();
    await waitFor(() => expect(useStore.getState().activeRole).toBe("viewer"));
    expect(useStore.getState().activeRoleStatus).toBe("pending");
  });

  it("stays read-only when role lookup fails or returns malformed data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    renderProvider();

    await waitFor(() => expect(useStore.getState().activeRole).toBe("viewer"));
    expect(useStore.getState().activeRoleStatus).toBe("unavailable");
    expect(screen.getByText("unavailable:viewer:read")).toBeInTheDocument();
  });

  it("reports membership as unavailable for the offline Viewer projection without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setOfflineReadState("tenant", true, Date.parse("2026-07-17T10:00:00.000Z"));
    const view = renderProvider();

    expect(screen.getByText("unavailable:viewer:read")).toBeInTheDocument();
    await waitFor(() => expect(useStore.getState().activeRole).toBe("viewer"));
    expect(useStore.getState().activeRoleStatus).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
    view.unmount(); // reset the global offline marker only after this provider stops observing it
  });
});

describe("PermissionProvider refresh behavior", () => {
  it("keeps role and store pending/viewer after offline clears until a fresh lookup resolves", async () => {
    let resolveRefresh!: (response: Response) => void;
    const refresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ id: useStore.getState().activeAccountId, name: "Wayne Enterprises", role: "owner" }]),
          { status: 200 },
        ),
      )
      .mockImplementationOnce(() => refresh);
    vi.stubGlobal("fetch", fetchMock);
    renderProvider();

    expect(await screen.findByText("resolved:owner:edit")).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe("owner");

    act(() => setOfflineReadState("tenant", true, Date.parse("2026-07-17T10:00:00.000Z")));
    expect(screen.getByText("unavailable:viewer:read")).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe("viewer");

    act(() => setOfflineReadState("cleanup", false));
    expect(screen.getByText("pending:viewer:read")).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe("viewer");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    resolveRefresh(
      new Response(
        JSON.stringify([{ id: useStore.getState().activeAccountId, name: "Wayne Enterprises", role: "admin" }]),
        {
          status: 200,
        },
      ),
    );
    expect(await screen.findByText("resolved:admin:edit")).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe("admin");
  });

  it("enables editing only after a concrete write-tier role resolves", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              id: useStore.getState().activeAccountId,
              name: "Wayne Enterprises",
              role: "editor",
            },
          ]),
          { status: 200 },
        ),
      ),
    );
    renderProvider();

    expect(screen.getByText("pending:viewer:read")).toBeInTheDocument();
    expect(await screen.findByText("resolved:editor:edit")).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe("editor");
  });
});

describe("PermissionProvider membership invalidation", () => {
  it("starts the directory read only after status resolves and adopts status before publishing the role", async () => {
    let resolveStatus!: (status: { active: false }) => void;
    permissionMocks.masqueradeStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify([{ id: useStore.getState().activeAccountId, name: "Wayne Enterprises", role: "owner" }]),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const adoptStatus = vi.spyOn(masqueradeController, "adoptStatus");
    const setActiveRole = vi.spyOn(useStore.getState(), "setActiveRole");

    renderProvider();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useStore.getState().activeRoleStatus).toBe("pending");
    resolveStatus({ active: false });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(await screen.findByText("resolved:owner:edit")).toBeInTheDocument();

    const resolvedRoleCall = setActiveRole.mock.calls.findIndex(
      ([role, status]) => role === "owner" && status === "resolved",
    );
    expect(resolvedRoleCall).toBeGreaterThanOrEqual(0);
    const resolvedRoleInvocationOrder = setActiveRole.mock.invocationCallOrder[resolvedRoleCall];
    if (resolvedRoleInvocationOrder === undefined) throw new Error("resolved role call was not recorded");
    expect(adoptStatus.mock.invocationCallOrder[0]).toBeLessThan(resolvedRoleInvocationOrder);
  });
});

describe("PermissionProvider membership generation", () => {
  it("re-resolves the active role when a membership mutation invalidates its projections", async () => {
    let role = "owner";
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              id: useStore.getState().activeAccountId,
              name: "Wayne Enterprises",
              role,
            },
          ]),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderProvider();

    expect(await screen.findByText("resolved:owner:edit")).toBeInTheDocument();
    role = "admin";
    act(() => useStore.getState().invalidateMemberships());

    expect(screen.getByText("pending:viewer:read")).toBeInTheDocument();
    expect(await screen.findByText("resolved:admin:edit")).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe("admin");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares one account-directory read per membership generation with the shell hook", async () => {
    let role = "owner";
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              id: useStore.getState().activeAccountId,
              name: "Wayne Enterprises",
              role,
            },
          ]),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderSharedDirectoryProvider();

    expect(await screen.findByText("resolved:owner:edit")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    role = "admin";
    act(() => useStore.getState().invalidateMemberships());

    expect(screen.getByText("pending:viewer:read")).toBeInTheDocument();
    expect(await screen.findByText("resolved:admin:edit")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("PermissionProvider account-switch safety", () => {
  it("fails closed in context and store immediately after switching from an owner account", async () => {
    addSecondAccount();
    const b = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(accountResponse("acct-test", "owner"))
        .mockImplementationOnce(() => b.promise),
    );
    renderProvider();

    expect(await screen.findByText("resolved:owner:edit")).toBeInTheDocument();
    act(() => useStore.getState().setActiveAccount("a-studio"));

    expect(screen.getByText("pending:viewer:read")).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe("viewer");
    expect(useStore.getState().activeRoleStatus).toBe("pending");

    await act(async () => b.resolve(accountResponse("a-studio", "editor")));
    expect(await screen.findByText("resolved:editor:edit")).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe("editor");
    expect(useStore.getState().activeRoleStatus).toBe("resolved");
  });

  it("does not adopt an old account's delayed masquerade status after a switch", async () => {
    addSecondAccount();
    const aStatus = deferred<{ active: false }>();
    permissionMocks.masqueradeStatus
      .mockImplementationOnce(() => aStatus.promise)
      .mockResolvedValueOnce({ active: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(accountResponse("a-studio", "editor")));
    const adoptStatus = vi.spyOn(masqueradeController, "adoptStatus");
    renderProvider();

    act(() => useStore.getState().setActiveAccount("a-studio"));
    expect(screen.getByText("pending:viewer:read")).toBeInTheDocument();
    expect(await screen.findByText("resolved:editor:edit")).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe("editor");

    await act(async () => aStatus.resolve({ active: false }));
    expect(adoptStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByText("resolved:editor:edit")).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe("editor");
  });
});

describe("PermissionProvider stale directory safety", () => {
  it("keeps B authoritative when A's delayed directory response resolves later", async () => {
    addSecondAccount();
    const a = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => a.promise)
      .mockResolvedValueOnce(accountResponse("a-studio", "admin"));
    vi.stubGlobal("fetch", fetchMock);
    renderProvider();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    act(() => useStore.getState().setActiveAccount("a-studio"));
    expect(await screen.findByText("resolved:admin:edit")).toBeInTheDocument();
    await act(async () => a.resolve(accountResponse("acct-test", "owner")));

    expect(screen.getByText("resolved:admin:edit")).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe("admin");
    expect(useStore.getState().activeRoleStatus).toBe("resolved");
  });

  it("does not let a stale A directory rejection overwrite B's role", async () => {
    addSecondAccount();
    const a = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => a.promise)
      .mockResolvedValueOnce(accountResponse("a-studio", "owner"));
    vi.stubGlobal("fetch", fetchMock);
    renderProvider();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    act(() => useStore.getState().setActiveAccount("a-studio"));
    expect(await screen.findByText("resolved:owner:edit")).toBeInTheDocument();
    await act(async () => a.reject(new Error("A timed out")));

    expect(screen.getByText("resolved:owner:edit")).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe("owner");
    expect(useStore.getState().activeRoleStatus).toBe("resolved");
  });
});

describe("PermissionProvider fail-closed responses", () => {
  it("fails closed for an absent or malformed active membership and clears only after a complete list proves absence", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(accountResponse("other", "owner"))
        .mockResolvedValueOnce(accountResponse("acct-test", "unknown-role")),
    );
    renderProvider();

    await waitFor(() => expect(useStore.getState().activeAccountId).toBeNull());
    expect(screen.getByText("not-applicable:none:edit")).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBeNull();
    expect(useStore.getState().activeRoleStatus).toBe("not-applicable");

    act(() => useStore.getState().setActiveAccount("acct-test"));
    expect(screen.getByText("pending:viewer:read")).toBeInTheDocument();
    expect(await screen.findByText("unavailable:viewer:read")).toBeInTheDocument();
    expect(useStore.getState().activeAccountId).toBe("acct-test");
    expect(useStore.getState().activeRole).toBe("viewer");
    expect(useStore.getState().activeRoleStatus).toBe("unavailable");
  });

  it("does not request permissions in off, demo, or null-account modes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const offView = render(
      <AuthContext.Provider value={{ ...auth, authMode: "off" }}>
        <PermissionProvider>
          <Probe />
        </PermissionProvider>
      </AuthContext.Provider>,
    );
    expect(screen.getByText("not-applicable:none:edit")).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBeNull();
    expect(useStore.getState().activeRoleStatus).toBe("not-applicable");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(permissionMocks.masqueradeStatus).not.toHaveBeenCalled();

    vi.stubEnv("VITE_CAPACITYLENS_DEMO", "1");
    const demoView = renderProvider();
    expect(screen.getAllByText("not-applicable:none:edit")).toHaveLength(2);
    expect(useStore.getState().activeRole).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(permissionMocks.masqueradeStatus).not.toHaveBeenCalled();

    offView.unmount();
    demoView.unmount();
    vi.stubEnv("VITE_CAPACITYLENS_DEMO", "");
    act(() => useStore.getState().setActiveAccount(null));
    renderProvider();
    expect(screen.getByText("not-applicable:none:edit")).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBeNull();
    expect(useStore.getState().activeRoleStatus).toBe("not-applicable");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(permissionMocks.masqueradeStatus).not.toHaveBeenCalled();
  });
});
