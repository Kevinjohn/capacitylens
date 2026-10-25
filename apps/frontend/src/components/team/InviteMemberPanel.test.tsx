import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InvitationRole } from "@capacitylens/shared/account/types";
import type { Role } from "@capacitylens/shared/domain/access";
import type { TeamInvitation } from "@/account/teamAccessClient";
import { InviteMemberPanel } from "./InviteMemberPanel";

type InvitePanelProps = React.ComponentProps<typeof InviteMemberPanel>;
type DialogProps = "inviteDialogOpen" | "openInviteDialog" | "closeInviteDialog";

function InvitePanelHarness(props: Omit<InvitePanelProps, DialogProps>) {
  const [open, setOpen] = useState(false);
  return (
    <InviteMemberPanel
      {...props}
      inviteDialogOpen={open}
      openInviteDialog={() => setOpen(true)}
      closeInviteDialog={() => setOpen(false)}
    />
  );
}

function renderInvite(overrides: Partial<Omit<InvitePanelProps, DialogProps>> = {}) {
  const props: Omit<InvitePanelProps, DialogProps> = {
    busy: false,
    inviteRole: "editor" satisfies InvitationRole,
    setInviteRole: vi.fn(),
    invitationPreauthorizedEmail: "",
    setInvitationPreauthorizedEmail: vi.fn(),
    error: null,
    errorField: null,
    errorId: "invite-error",
    clear: vi.fn(),
    submitInvite: vi.fn(async () => {}),
    invites: [],
    renderedAt: Date.now(),
    revokeInvite: vi.fn(async () => {}),
    resendInvite: vi.fn(async () => {}),
    roleOptions: [{ value: "editor" satisfies Role, label: "Editor" }],
    ...overrides,
  };
  render(<InvitePanelHarness {...props} />);
  return props;
}

const invitation = (overrides: Partial<TeamInvitation>): TeamInvitation => ({
  id: "1",
  role: "editor",
  preauthEmail: "diana@example.com",
  expiresAt: "2099-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("InviteMemberPanel creation guidance", () => {
  it("keeps the invite form closed until the primary invite button is activated", async () => {
    const user = userEvent.setup();
    renderInvite();

    expect(screen.queryByTestId("invite-preauth")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("invite-open"));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Invite someone");
    expect(dialog).toHaveAccessibleDescription(/emails each invitation/);
    expect(dialog.querySelectorAll('[data-product-layout="label-control"]')).toHaveLength(2);
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("requires a plain Email field", () => {
    renderInvite();
    fireEvent.click(screen.getByTestId("invite-open"));

    expect(screen.getByLabelText("Email")).toBe(screen.getByTestId("invite-preauth"));
    expect(screen.getByTestId("invite-preauth")).toHaveAttribute("aria-required", "true");
    expect(screen.getByTestId("invite-preauth")).not.toHaveAttribute("aria-describedby");
  });

  it("associates only the conditional error with Email", () => {
    renderInvite({ error: "Enter a valid email address.", errorField: "invite" });
    fireEvent.click(screen.getByTestId("invite-open"));

    expect(screen.getByTestId("invite-preauth")).toHaveAttribute("aria-describedby", "invite-error");
  });
});

describe("InviteMemberPanel outstanding invites", () => {
  it("renders pending invites in their own bordered section outside the invite dialog", () => {
    renderInvite({ invites: [invitation({})] });

    const section = screen.getByTestId("outstanding-invites");
    expect(section).toHaveTextContent("Outstanding invites");
    expect(within(section).getByRole("table").parentElement).toHaveClass("border");
    expect(screen.queryByTestId("invite-preauth")).not.toBeInTheDocument();
  });

  it("orders invites deterministically and offers resend for each, revoke only while live", () => {
    renderInvite({
      renderedAt: Date.parse("2026-06-01T00:00:00.000Z"),
      invites: [
        invitation({ id: "4", role: "viewer", preauthEmail: "viewer@example.com" }),
        invitation({ id: "3", role: "admin", preauthEmail: "same@example.com", expiresAt: "2026-01-01T00:00:00.000Z" }),
        invitation({ id: "2", role: "admin", preauthEmail: "same@example.com" }),
      ],
    });

    const table = within(screen.getByTestId("outstanding-invites")).getByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual(["Email", "Role", "Actions"]);
    expect(headers.every((header) => header.getAttribute("scope") === "col")).toBe(true);
    const rows = within(table).getAllByTestId("invite-row");
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual([
      expect.stringContaining("same@example.com"),
      expect.stringContaining("same@example.com"),
      expect.stringContaining("viewer@example.com"),
    ]);
    expect(rows[0]).toHaveTextContent(/expires/i);
    expect(rows[1]).toHaveTextContent(/expired/i);
    expect(within(table).getAllByTestId("invite-resend")).toHaveLength(3);
    expect(within(table).getAllByTestId("invite-revoke")).toHaveLength(2);
  });

  it("resends the chosen invitation", async () => {
    const props = renderInvite({ invites: [invitation({})] });

    await userEvent.click(screen.getByRole("button", { name: "Resend the invitation to diana@example.com" }));

    expect(props.resendInvite).toHaveBeenCalledWith(invitation({}));
  });
});
