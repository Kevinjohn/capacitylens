import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InvitationRole } from "@capacitylens/shared/account/types";
import type { Role } from "@capacitylens/shared/domain/access";
import { InviteMemberPanel } from "./InviteMemberPanel";

type InvitePanelProps = React.ComponentProps<typeof InviteMemberPanel>;
type DialogProps = "inviteDialogOpen" | "openInviteDialog" | "closeInviteDialog";

// The dialog's open state is owned by the caller; hold it here as MembersSection's hook does.
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
    authMode: "password",
    busy: false,
    inviteRole: "editor" satisfies InvitationRole,
    setInviteRole: vi.fn(),
    invitationPreauthorizedEmail: "",
    setInvitationPreauthorizedEmail: vi.fn(),
    error: null,
    errorField: null,
    errorId: "invite-error",
    clear: vi.fn(),
    mintedLink: null,
    copyLink: vi.fn(),
    submitInvite: vi.fn(async () => {}),
    invites: [],
    renderedAt: Date.now(),
    revokeInvite: vi.fn(async () => {}),
    roleOptions: [{ value: "editor" satisfies Role, label: "Editor" }],
    invitationPeople: [],
    invitationResourceId: "",
    setInvitationResourceId: vi.fn(),
    ...overrides,
  };
  return render(<InvitePanelHarness {...props} />);
}

describe("InviteMemberPanel creation guidance", () => {
  it("keeps the invite form closed until the primary invite button is activated", async () => {
    const user = userEvent.setup();
    renderInvite();

    expect(screen.getByTestId("invite-open")).toBeInTheDocument();
    expect(screen.queryByTestId("invite-preauth")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("invite-open"));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Invite someone");
    expect(dialog).toHaveAccessibleDescription(/CapacityLens does not send invitation emails/);
    expect(dialog.querySelector('[data-slot="dialog-header"]')).toHaveClass("border-b");
    expect(dialog.querySelector("form > div.p-4")).toBeInTheDocument();
    expect(dialog.querySelector('[data-slot="dialog-footer"]')).toHaveClass("border-t");
    expect(dialog.querySelectorAll('[data-product-layout="label-control"]')).toHaveLength(3);
    const roleField = within(dialog).getByTestId("invite-role").closest('[data-product-layout="label-control"]');
    const emailField = within(dialog).getByTestId("invite-preauth").closest('[data-product-layout="label-control"]');
    const personField = within(dialog).getByTestId("invite-person").closest('[data-product-layout="label-control"]');
    expect(roleField?.parentElement).toBe(emailField?.parentElement);
    expect(roleField?.parentElement).toBe(personField?.parentElement);
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByTestId("invite-preauth")).toBeInTheDocument();
  });

  it("renders outstanding invites in their own bordered section outside the invite dialog", () => {
    renderInvite({
      invites: [
        {
          id: "invite-1",
          role: "editor",
          preauthEmail: null,
          expiresAt: "2099-01-01T00:00:00.000Z",
          usedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const section = screen.getByTestId("outstanding-invites");
    expect(section).toHaveTextContent("Outstanding invites");
    expect(within(section).getByRole("table").parentElement).toHaveClass("border");
    expect(section).not.toHaveAttribute("data-slot", "card");
    expect(screen.queryByTestId("invite-preauth")).not.toBeInTheDocument();
  });

  it("uses a plain Email label without field exposition", () => {
    renderInvite();
    fireEvent.click(screen.getByTestId("invite-open"));

    expect(screen.getByTestId("invites-section")).toHaveTextContent(
      "CapacityLens does not send invitation emails. After creating an invite, copy the link and send it yourself.",
    );
    expect(screen.getByLabelText("Email")).toBe(screen.getByTestId("invite-preauth"));
    expect(screen.getByTestId("invite-preauth")).not.toHaveAttribute("aria-required");
    expect(screen.getByTestId("invite-preauth")).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(/Supply an email to restrict this invite/)).not.toBeInTheDocument();
  });

  it("marks Email as required for SSO invitations without adding helper copy", () => {
    renderInvite({ authMode: "sso" });
    fireEvent.click(screen.getByTestId("invite-open"));

    expect(screen.getByLabelText("Email")).toBe(screen.getByTestId("invite-preauth"));
    expect(screen.getByTestId("invite-preauth")).toHaveAttribute("aria-required", "true");
    expect(screen.getByTestId("invite-preauth")).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(/verified company login/)).not.toBeInTheDocument();
  });

  it("associates only the conditional error with Email", () => {
    renderInvite({ error: "Enter a valid email address.", errorField: "invite" });
    fireEvent.click(screen.getByTestId("invite-open"));

    expect(screen.getByTestId("invite-preauth")).toHaveAttribute("aria-describedby", "invite-error");
  });

  it("keeps the minted link and its recovery instructions in an inline status", () => {
    renderInvite({
      mintedLink: { inviteId: "invite-1", link: "https://app.example/invite/secret" },
    });
    fireEvent.click(screen.getByTestId("invite-open"));

    const status = screen.getByTestId("invite-created-status");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveTextContent("Invite created. Copy this link and send it yourself.");
    expect(status).toHaveTextContent("If you lose it, revoke this invite and create a new one.");
    expect(status).toContainElement(screen.getByRole("button", { name: "Copy invitation link" }));
  });

  it("defaults the private schedule-person proposal to not on the schedule", async () => {
    renderInvite({ invitationPeople: [{ id: "r1", label: "Bruce Wayne" }] });
    await userEvent.click(screen.getByTestId("invite-open"));

    expect(screen.getByTestId("invite-person")).toHaveValue("");
    await userEvent.click(screen.getByTestId("invite-person"));
    expect(screen.getByRole("option", { name: "No Resource linked" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Bruce Wayne" })).toBeInTheDocument();
  });

  it("renders a proposed Resource as compact pending information", () => {
    renderInvite({
      invitationPeople: [{ id: "r1", label: "Bruce Wayne" }],
      invites: [
        {
          id: "invite-1",
          role: "editor",
          preauthEmail: null,
          expiresAt: "2099-01-01T00:00:00.000Z",
          usedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          proposedResourceId: "r1",
        },
      ],
    });
    fireEvent.click(screen.getByTestId("invite-open"));

    expect(screen.getByTestId("invite-row")).toHaveTextContent("Bruce Wayne Pending");
  });

  it("uses the five-column contract and deterministically orders invitation states", () => {
    renderInvite({
      renderedAt: Date.parse("2026-06-01T00:00:00.000Z"),
      invitationPeople: [{ id: "r1", label: "Bruce Wayne" }],
      invites: [
        {
          id: "viewer",
          role: "viewer",
          preauthEmail: null,
          expiresAt: "2099-01-01T00:00:00.000Z",
          usedAt: null,
          createdAt: "2026-01-03T00:00:00.000Z",
        },
        {
          id: "editor-used",
          role: "editor",
          preauthEmail: "used@example.com",
          expiresAt: "2099-01-01T00:00:00.000Z",
          usedAt: "2026-02-01T00:00:00.000Z",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "admin-b",
          role: "admin",
          preauthEmail: "same@example.com",
          expiresAt: "2026-01-01T00:00:00.000Z",
          usedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          proposedResourceId: "r1",
        },
        {
          id: "admin-a",
          role: "admin",
          preauthEmail: "same@example.com",
          expiresAt: "2099-01-01T00:00:00.000Z",
          usedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          proposedResourceId: "r1",
        },
      ],
    });

    const table = within(screen.getByTestId("outstanding-invites")).getByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual([
      "Name",
      "Role",
      "Email",
      "Link to Resource",
      "Actions",
    ]);
    expect(headers.every((header) => header.getAttribute("scope") === "col")).toBe(true);
    const rows = within(table).getAllByTestId("invite-row");
    expect(rows.map((row) => within(row).getAllByRole("cell")[2]?.textContent)).toEqual([
      expect.stringContaining("same@example.com"),
      expect.stringContaining("same@example.com"),
      expect.stringContaining("used@example.com"),
      expect.stringContaining("Invite link"),
    ]);
    expect(rows[0]).toHaveTextContent(/expires/i);
    expect(rows[0]).toHaveTextContent("Bruce Wayne Pending");
    expect(rows[1]).toHaveTextContent(/expired/i);
    expect(rows[1]).toHaveTextContent("Bruce Wayne");
    expect(rows[1]).not.toHaveTextContent("Pending");
    expect(rows[2]).toHaveTextContent(/used/i);
    expect(within(table).getAllByTestId("invite-revoke")).toHaveLength(2);
    const [firstRow] = rows;
    expect(firstRow).toBeDefined();
    if (!firstRow) throw new Error("Expected at least one invitation row.");
    expect(within(firstRow).getByText("same@example.com")).toHaveAttribute("title", "same@example.com");
  });
});
