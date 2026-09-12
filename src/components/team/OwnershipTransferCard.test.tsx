import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { m } from "@/i18n";
import { AuthContext, type AuthContextValue } from "../../auth/authContext";
import type {
  OwnershipTransferOutcomeView,
  OwnershipTransferProjectionView,
  OwnershipTransferView,
  TeamMember,
} from "../../account/teamAccessClient";
import { DEFAULT_ACCOUNT_ID, resetStoreWithAccount } from "../../test/fixtures";
import { useStore } from "../../store/useStore";
import { OwnershipTransferCard } from "./OwnershipTransferCard";

/**
 * The card's contract with the person reading it: it offers only the controls their side of the
 * ceremony owns, and it explains an outcome someone else committed. The server re-checks every
 * authority independently, so these assertions are about honesty of presentation, not enforcement.
 */

const client = vi.hoisted(() => ({
  readOwnershipTransfer: vi.fn(),
  listMembers: vi.fn(),
  initiateOwnershipTransfer: vi.fn(),
  commandOwnershipTransfer: vi.fn(),
}));

vi.mock("../../account/teamAccessClient", () => ({ teamAccessClient: client }));
vi.mock("../../auth/reprojectAccess", () => ({ reprojectAccess: async () => true }));

function member(userId: string, role: TeamMember["role"], name: string): TeamMember {
  return {
    userId,
    role,
    status: "active",
    createdAt: "2026-09-01T00:00:00.000Z",
    name,
    email: `${userId}@wayne.test`,
    signInConfirmed: null,
    isSelf: false,
    mayResetPassword: false,
    mayRevokeSessions: false,
  };
}

const OWNER = member("bruce", "owner", "Bruce Wayne");
const NOMINEE = member("selina", "admin", "Selina Kyle");
const OTHER_ADMIN = member("alfred", "admin", "Alfred Pennyworth");
const OTHER_ACCOUNT_ID = "a-loft";

function request(overrides: Partial<OwnershipTransferView> = {}): OwnershipTransferView {
  return {
    id: "req-1",
    fromUserId: OWNER.userId,
    toUserId: NOMINEE.userId,
    state: "awaiting_target",
    revision: "1",
    createdAt: "2026-09-10T00:00:00.000Z",
    expiresAt: "2026-09-17T00:00:00.000Z",
    targetAcceptedAt: null,
    terminalAt: null,
    terminalReason: null,
    ...overrides,
  };
}

function seed(projection: OwnershipTransferProjectionView, members: readonly TeamMember[] = [OWNER, NOMINEE]): void {
  client.readOwnershipTransfer.mockResolvedValue({ kind: "ok", status: 200, value: projection });
  client.listMembers.mockResolvedValue({ kind: "ok", status: 200, value: { members } });
}

function renderAs(userId: string) {
  const auth: AuthContextValue = {
    authMode: "password",
    user: { id: userId, email: `${userId}@wayne.test` },
    canCreateAccount: true,
    multiAccount: true,
    refreshAuth: async () => {},
    signOut: async () => {},
  };
  return render(
    <AuthContext.Provider value={auth}>
      <OwnershipTransferCard />
    </AuthContext.Provider>,
  );
}

const applied = (
  value: OwnershipTransferView,
): { kind: "ok"; status: number; value: OwnershipTransferOutcomeView } => ({
  kind: "ok",
  status: 200,
  value: { kind: "applied", request: value },
});

beforeEach(() => {
  vi.clearAllMocks();
  resetStoreWithAccount(DEFAULT_ACCOUNT_ID);
});

describe("OwnershipTransferCard as the Owner", () => {
  it("offers the Admins of the company and nominates the chosen one", async () => {
    seed({ live: null, latestOutcome: null });
    client.initiateOwnershipTransfer.mockResolvedValue(applied(request()));
    renderAs(OWNER.userId);

    const select = await screen.findByTestId("ownership-transfer-nominee");
    select.focus();
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: NOMINEE.name ?? "" }));
    fireEvent.click(screen.getByTestId("ownership-transfer-start"));

    await waitFor(() => {
      expect(client.initiateOwnershipTransfer).toHaveBeenCalledWith({
        workspaceId: DEFAULT_ACCOUNT_ID,
        targetPrincipalId: NOMINEE.userId,
      });
    });
  });

  it("waits for consent before offering confirmation", async () => {
    seed({ live: request(), latestOutcome: null });
    renderAs(OWNER.userId);

    expect(await screen.findByTestId("ownership-transfer-state")).toHaveTextContent(NOMINEE.name ?? "");
    expect(screen.queryByTestId("ownership-transfer-complete")).toBeNull();
    expect(screen.getByTestId("ownership-transfer-cancel")).toBeInTheDocument();
  });

  it("sends the confirmation against the revision it read", async () => {
    seed({
      live: request({ state: "awaiting_owner", revision: "2", targetAcceptedAt: "2026-09-11T00:00:00.000Z" }),
      latestOutcome: null,
    });
    client.commandOwnershipTransfer.mockResolvedValue(applied(request({ state: "completed" })));
    renderAs(OWNER.userId);

    fireEvent.click(await screen.findByTestId("ownership-transfer-complete"));

    await waitFor(() => {
      expect(client.commandOwnershipTransfer).toHaveBeenCalledWith({
        workspaceId: DEFAULT_ACCOUNT_ID,
        requestId: "req-1",
        step: "complete",
        expectedRevision: "2",
      });
    });
  });

  it("names the request it replaces when nominating someone else", async () => {
    seed({ live: request({ revision: "3" }), latestOutcome: null }, [OWNER, NOMINEE, OTHER_ADMIN]);
    client.initiateOwnershipTransfer.mockResolvedValue(applied(request({ toUserId: OTHER_ADMIN.userId })));
    renderAs(OWNER.userId);

    const select = await screen.findByTestId("ownership-transfer-nominee");
    select.focus();
    fireEvent.keyDown(select, { key: "ArrowDown" });
    // The standing nominee is not offered again: replacing a request with itself is not a choice.
    expect(screen.queryByRole("option", { name: NOMINEE.name ?? "" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: OTHER_ADMIN.name ?? "" }));
    fireEvent.click(screen.getByTestId("ownership-transfer-replace"));

    await waitFor(() => {
      expect(client.initiateOwnershipTransfer).toHaveBeenCalledWith({
        workspaceId: DEFAULT_ACCOUNT_ID,
        targetPrincipalId: OTHER_ADMIN.userId,
        replaces: { requestId: "req-1", revision: "3" },
      });
    });
  });
});

describe("OwnershipTransferCard as the nominee", () => {
  it("offers consent and refusal, never the Owner's controls", async () => {
    seed({ live: request(), latestOutcome: null });
    renderAs(NOMINEE.userId);

    expect(await screen.findByTestId("ownership-transfer-accept")).toBeInTheDocument();
    expect(screen.getByTestId("ownership-transfer-decline")).toBeInTheDocument();
    expect(screen.queryByTestId("ownership-transfer-complete")).toBeNull();
    expect(screen.queryByTestId("ownership-transfer-cancel")).toBeNull();
  });

  it("can take consent back while the Owner has not confirmed", async () => {
    seed({ live: request({ state: "awaiting_owner", revision: "2" }), latestOutcome: null });
    client.commandOwnershipTransfer.mockResolvedValue(applied(request()));
    renderAs(NOMINEE.userId);

    fireEvent.click(await screen.findByTestId("ownership-transfer-withdraw"));

    await waitFor(() => {
      expect(client.commandOwnershipTransfer).toHaveBeenCalledWith({
        workspaceId: DEFAULT_ACCOUNT_ID,
        requestId: "req-1",
        step: "withdraw",
        expectedRevision: "2",
      });
    });
  });
});

describe("OwnershipTransferCard outcomes", () => {
  it("explains how the last request ended to a participant with nothing live", async () => {
    seed({
      live: null,
      latestOutcome: request({
        state: "declined",
        terminalReason: "target_declined",
        terminalAt: "2026-09-11T00:00:00.000Z",
      }),
    });
    renderAs(NOMINEE.userId);

    expect(await screen.findByTestId("ownership-transfer-outcome")).toHaveTextContent(
      m.ownership_transfer_outcome_declined(),
    );
  });

  it("tells the Owner how the last request ended while still offering a new one", async () => {
    seed({
      live: null,
      latestOutcome: request({
        state: "declined",
        terminalReason: "target_declined",
        terminalAt: "2026-09-11T00:00:00.000Z",
      }),
    });
    renderAs(OWNER.userId);

    // The Owner can always start a transfer, so the explanation must sit BESIDE the nominate
    // control: showing one instead of the other loses the only account of what happened.
    const outcome = await screen.findByTestId("ownership-transfer-outcome");
    expect(outcome).toHaveTextContent(m.ownership_transfer_outcome_declined());
    expect(outcome).toHaveTextContent(new Date("2026-09-11T00:00:00.000Z").toLocaleDateString());
    expect(screen.getByTestId("ownership-transfer-start")).toBeInTheDocument();
  });

  it("renders nothing for someone with no ceremony and no standing to start one", async () => {
    seed({ live: null, latestOutcome: null });
    renderAs(NOMINEE.userId);

    await waitFor(() => {
      expect(client.readOwnershipTransfer).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("ownership-transfer-card")).toBeNull();
  });

  it("explains a terminal outcome the server committed while the command was in flight", async () => {
    seed({ live: request(), latestOutcome: null });
    client.commandOwnershipTransfer.mockResolvedValue({
      kind: "ok",
      status: 409,
      value: { kind: "terminal", state: "expired", reason: "deadline_passed" },
    });
    renderAs(NOMINEE.userId);

    fireEvent.click(await screen.findByTestId("ownership-transfer-accept"));

    expect(await screen.findByText(m.ownership_transfer_outcome_expired())).toBeInTheDocument();
  });

  it("keeps a rejected command from disabling every control with nothing said", async () => {
    seed({ live: request(), latestOutcome: null });
    client.commandOwnershipTransfer.mockRejectedValue(new Error("offline"));
    renderAs(NOMINEE.userId);

    fireEvent.click(await screen.findByTestId("ownership-transfer-accept"));

    expect(await screen.findByText(m.ownership_transfer_command_failed())).toBeInTheDocument();
    // A stuck `busy` would leave the ceremony unreachable until a full page reload.
    await waitFor(() => {
      expect(screen.getByTestId("ownership-transfer-accept")).toBeEnabled();
    });
  });

  it("prefers its own sentence to a message that only describes our uncertainty", async () => {
    seed({ live: request(), latestOutcome: null });
    client.commandOwnershipTransfer.mockResolvedValue({
      kind: "invalid",
      status: 200,
      message: "The server returned an invalid response.",
    });
    renderAs(NOMINEE.userId);

    fireEvent.click(await screen.findByTestId("ownership-transfer-accept"));

    expect(await screen.findByText(m.ownership_transfer_command_failed())).toBeInTheDocument();
    expect(screen.queryByText("The server returned an invalid response.")).toBeNull();
  });

  it("shows a server-authored refusal as the server wrote it", async () => {
    seed({ live: request(), latestOutcome: null });
    client.commandOwnershipTransfer.mockResolvedValue({
      kind: "rejected",
      status: 409,
      message: "Ownership transfer changed.",
    });
    renderAs(NOMINEE.userId);

    fireEvent.click(await screen.findByTestId("ownership-transfer-accept"));

    expect(await screen.findByText("Ownership transfer changed.")).toBeInTheDocument();
  });

  it("tells a nominee whose read failed, rather than showing them an empty page", async () => {
    client.readOwnershipTransfer.mockRejectedValue(new Error("offline"));
    client.listMembers.mockResolvedValue({ kind: "ok", status: 200, value: { members: [OWNER, NOMINEE] } });
    renderAs(NOMINEE.userId);

    expect(await screen.findByText(m.ownership_transfer_read_failed())).toBeInTheDocument();
  });

  it("empties the card when the company changes, even if the next read fails", async () => {
    seed({ live: request(), latestOutcome: null });
    renderAs(NOMINEE.userId);
    expect(await screen.findByTestId("ownership-transfer-state")).toBeInTheDocument();

    // The next company's read fails: what stays on screen must not be the previous company's
    // nomination, which names two people who may not even be members here.
    client.readOwnershipTransfer.mockRejectedValue(new Error("offline"));
    client.listMembers.mockRejectedValue(new Error("offline"));
    act(() => {
      // Straight at the slice: the picker refuses an id it has no company for, and which company is
      // active is the only part of the switch this card reacts to.
      useStore.setState({ activeAccountId: OTHER_ACCOUNT_ID });
    });

    expect(await screen.findByText(m.ownership_transfer_read_failed())).toBeInTheDocument();
    expect(screen.queryByTestId("ownership-transfer-state")).toBeNull();
  });

  it("tells the Owner when the member directory could not be read", async () => {
    client.readOwnershipTransfer.mockResolvedValue({
      kind: "ok",
      status: 200,
      value: { live: null, latestOutcome: null },
    });
    client.listMembers.mockResolvedValue({ kind: "error", status: 500, message: "boom" });
    renderAs(OWNER.userId);

    // Without the directory there is no nominee list and no name to print, so rendering nothing
    // would look exactly like "you have no transfer and cannot start one" to the one person who can.
    expect(await screen.findByText(m.ownership_transfer_read_failed())).toBeInTheDocument();
  });

  it("does not keep a settled ceremony on screen when the re-read fails", async () => {
    seed({ live: request(), latestOutcome: null });
    client.commandOwnershipTransfer.mockResolvedValue(applied(request({ state: "declined" })));
    renderAs(NOMINEE.userId);

    fireEvent.click(await screen.findByTestId("ownership-transfer-accept"));
    client.readOwnershipTransfer.mockRejectedValue(new Error("offline"));
    client.listMembers.mockRejectedValue(new Error("offline"));

    // Offering Accept again at the old revision would be refused by the server every time.
    await waitFor(() => {
      expect(screen.queryByTestId("ownership-transfer-accept")).toBeNull();
    });
  });

  it("reports a failed read without blanking the card", async () => {
    client.readOwnershipTransfer.mockResolvedValue({ kind: "error", status: 500, message: "boom" });
    client.listMembers.mockResolvedValue({ kind: "ok", status: 200, value: { members: [OWNER, NOMINEE] } });
    renderAs(OWNER.userId);

    expect(await screen.findByText(m.ownership_transfer_read_failed())).toBeInTheDocument();
  });
});
