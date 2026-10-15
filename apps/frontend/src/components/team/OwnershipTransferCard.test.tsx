import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { m } from "@/i18n";
import { AuthContext } from "@/auth/authContext";
import type { AuthContextValue } from "@/auth/authContext";
import { PermissionContext } from "@/auth/permissionContext";
import type { TeamMember } from "@/account/teamAccessClient";
import { DEFAULT_ACCOUNT_ID, resetStoreWithAccount } from "@/test/fixtures";
import { setOfflineReadState } from "@/data/offlineCache";
import { useStore } from "@/store/useStore";
import { OwnershipTransferCard } from "./OwnershipTransferCard";

const client = vi.hoisted(() => ({ listMembers: vi.fn(), transferOwnership: vi.fn() }));
const reproject = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/account/teamAccessClient", () => ({ teamAccessClient: client }));
vi.mock("@/auth/reprojectAccess", () => ({ reprojectAccess: reproject }));

function member({
  userId,
  role,
  name,
  status = "active",
}: {
  userId: string;
  role: TeamMember["role"];
  name: string;
  status?: TeamMember["status"];
}): TeamMember {
  return {
    userId,
    role,
    status,
    createdAt: "2026-09-01T00:00:00.000Z",
    name,
    email: `${userId}@wayne.test`,
    signInConfirmed: null,
    isSelf: userId === "bruce",
    mayResetPassword: false,
    mayRevokeSessions: false,
  };
}

const OWNER = member({ userId: "bruce", role: "owner", name: "Bruce Wayne" });
const ADMIN = member({ userId: "selina", role: "admin", name: "Selina Kyle" });
const INACTIVE_ADMIN = member({ userId: "alfred", role: "admin", name: "Alfred Pennyworth", status: "disabled" });

function renderAs({
  role = "owner",
  authMode = "password-only",
  refreshAuth = vi.fn(async () => {}),
}: {
  role?: "owner" | "admin" | "editor" | "viewer";
  authMode?: AuthContextValue["authMode"];
  refreshAuth?: () => Promise<void>;
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const auth: AuthContextValue = {
    authMode,
    user: authMode === "off" ? null : { id: "bruce", email: "bruce@wayne.test" },
    canCreateAccount: false,
    multiAccount: false,
    refreshAuth,
    signOut: async () => {},
  };
  return {
    refreshAuth,
    ...render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={auth}>
          <PermissionContext.Provider value={{ role, status: "resolved" }}>
            <OwnershipTransferCard />
          </PermissionContext.Provider>
        </AuthContext.Provider>
      </QueryClientProvider>,
    ),
  };
}

async function openOwnershipDialog(): Promise<void> {
  fireEvent.click(await screen.findByTestId("ownership-transfer-open"));
  await screen.findByRole("dialog", { name: m.ownership_transfer_heading() });
}

async function selectNextOwner(): Promise<void> {
  fireEvent.click(await screen.findByRole("combobox", { name: m.ownership_transfer_nominee_label() }));
  fireEvent.click(await screen.findByRole("option", { name: ADMIN.name ?? "" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  client.listMembers.mockResolvedValue({ kind: "ok", status: 200, value: { members: [OWNER, ADMIN, INACTIVE_ADMIN] } });
  client.transferOwnership.mockResolvedValue({
    kind: "ok",
    status: 200,
    value: { fromUserId: OWNER.userId, toUserId: ADMIN.userId },
  });
  reproject.mockResolvedValue(true);
  resetStoreWithAccount(DEFAULT_ACCOUNT_ID);
  setOfflineReadState({ owner: "cleanup", readOnly: false });
});

describe("OwnershipTransferCard", () => {
  it("lets the Owner confirm an immediate transfer to an active Admin", async () => {
    const refreshAuth = vi.fn(async () => {});
    renderAs({ refreshAuth });
    await openOwnershipDialog();
    await selectNextOwner();

    expect(screen.getByTestId("ownership-transfer-confirmation")).toHaveTextContent(
      m.ownership_transfer_confirmation(),
    );
    expect(screen.queryByRole("option", { name: INACTIVE_ADMIN.name ?? "" })).toBeNull();
    const transfer = screen.getByTestId("ownership-transfer-complete");
    expect(transfer).toHaveTextContent(m.ownership_transfer_submit());
    fireEvent.click(transfer);

    await waitFor(() => {
      expect(client.transferOwnership).toHaveBeenCalledWith({
        workspaceId: DEFAULT_ACCOUNT_ID,
        targetPrincipalId: ADMIN.userId,
      });
    });
    await waitFor(() => expect(reproject).toHaveBeenCalledWith(DEFAULT_ACCOUNT_ID));
    expect(refreshAuth).toHaveBeenCalledOnce();
  });

  it("shows a clear empty state when there are no eligible Admins", async () => {
    client.listMembers.mockResolvedValue({ kind: "ok", status: 200, value: { members: [OWNER, INACTIVE_ADMIN] } });
    renderAs();
    await openOwnershipDialog();

    expect(await screen.findByTestId("ownership-transfer-no-candidates")).toHaveTextContent(
      m.ownership_transfer_no_candidates(),
    );
    expect(screen.queryByTestId("ownership-transfer-complete")).toBeNull();
  });

  it("retains the same target after an uncertain response and refreshes authority", async () => {
    client.transferOwnership
      .mockResolvedValueOnce({ kind: "unknown", status: 503, message: null })
      .mockResolvedValueOnce({ kind: "ok", status: 200, value: { fromUserId: "bruce", toUserId: "selina" } });
    renderAs();
    await openOwnershipDialog();
    await selectNextOwner();

    fireEvent.click(await screen.findByTestId("ownership-transfer-complete"));
    expect(await screen.findByText(m.ownership_transfer_uncertain())).toBeInTheDocument();
    await waitFor(() => expect(reproject).toHaveBeenCalledOnce());

    fireEvent.click(await screen.findByTestId("ownership-transfer-complete"));
    await waitFor(() => expect(client.transferOwnership).toHaveBeenCalledTimes(2));
    expect(client.transferOwnership.mock.calls).toEqual([
      [{ workspaceId: DEFAULT_ACCOUNT_ID, targetPrincipalId: ADMIN.userId }],
      [{ workspaceId: DEFAULT_ACCOUNT_ID, targetPrincipalId: ADMIN.userId }],
    ]);
  });

  it("closes the active company if authoritative access cannot be reconciled", async () => {
    reproject.mockResolvedValue(false);
    renderAs();
    await openOwnershipDialog();
    await selectNextOwner();
    fireEvent.click(screen.getByTestId("ownership-transfer-complete"));

    await waitFor(() => expect(useStore.getState().activeAccountId).toBeNull());
    expect(useStore.getState().notice?.message).toBe(m.settings_members_access_refresh_failed());
  });

  it("does not render transfer controls for a non-Owner, offline user, or masqueraded view", () => {
    const nonOwner = renderAs({ role: "admin" });
    expect(screen.queryByTestId("ownership-transfer-card")).toBeNull();
    expect(client.listMembers).not.toHaveBeenCalled();
    nonOwner.unmount();

    setOfflineReadState({ owner: "tenant", readOnly: true });
    renderAs();
    expect(screen.queryByTestId("ownership-transfer-card")).toBeNull();
    expect(client.listMembers).not.toHaveBeenCalled();
    setOfflineReadState({ owner: "cleanup", readOnly: false });

    useStore.setState({
      masquerade: {
        kind: "active",
        state: {
          accountId: DEFAULT_ACCOUNT_ID,
          targetUserId: "selina",
          targetName: "Selina Kyle",
          effectiveRole: "owner",
          startedAt: "2026-09-01T00:00:00.000Z",
          token: "masquerade-token",
        },
        generation: 1,
      },
    });
    renderAs();
    expect(screen.queryByTestId("ownership-transfer-card")).toBeNull();
    expect(client.listMembers).not.toHaveBeenCalled();
  });
});
