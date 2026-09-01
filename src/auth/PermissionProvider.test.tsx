import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { PermissionProvider } from "./PermissionProvider";
import { AuthContext, type AuthContextValue } from "./authContext";
import { useCanEdit, usePermissionStatus, useRole } from "./permissionContext";
import { resetStoreWithAccount } from "../test/fixtures";
import { useStore } from "../store/useStore";
import { setOfflineReadState } from "../data/offlineCache";
import { useAccountSummaries } from "./useAccountSummaries";

vi.mock("./masqueradeApi", () => ({
  masqueradeApi: { status: vi.fn(async () => ({ active: false })) },
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

beforeEach(() => {
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
