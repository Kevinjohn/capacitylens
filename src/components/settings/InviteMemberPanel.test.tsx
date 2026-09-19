import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InvitationRole } from "@capacitylens/shared/account/types";
import type { Role } from "@capacitylens/shared/domain/access";
import { InviteMemberPanel } from "./InviteMemberPanel";

function renderInvite(overrides: Partial<React.ComponentProps<typeof InviteMemberPanel>> = {}) {
  const props: React.ComponentProps<typeof InviteMemberPanel> = {
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
  return render(<InviteMemberPanel {...props} />);
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
    expect(section).toHaveClass("border");
    expect(section).not.toHaveAttribute("data-slot", "card");
    expect(screen.queryByTestId("invite-preauth")).not.toBeInTheDocument();
  });

  it("explains that CapacityLens does not send invitation emails and describes generic versus restricted links", () => {
    renderInvite();
    fireEvent.click(screen.getByTestId("invite-open"));

    expect(screen.getByTestId("invites-section")).toHaveTextContent(
      "CapacityLens does not send invitation emails. After creating an invite, copy the link and send it yourself.",
    );
    expect(screen.getByTestId("invite-preauth")).not.toHaveAttribute("aria-required");
    expect(
      screen.getByText(
        "Supply an email to restrict this invite to that recipient. Leave it empty for a generic one-use link that can be shared with anyone.",
      ),
    ).toBeInTheDocument();
  });

  it("marks the pre-authorised email as required for SSO invitations", () => {
    renderInvite({ authMode: "sso" });
    fireEvent.click(screen.getByTestId("invite-open"));

    expect(screen.getByTestId("invite-preauth")).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("The invitee must use this email with their verified company login.")).toBeInTheDocument();
  });

  it.each([
    [
      "password",
      "Supply an email to restrict this invite to that recipient. Leave it empty for a generic one-use link that can be shared with anyone.",
    ],
    ["sso", "The invitee must use this email with their verified company login."],
  ] as const)("describes a valid %s pre-authorised email field persistently", (authMode, description) => {
    renderInvite({ authMode });
    fireEvent.click(screen.getByTestId("invite-open"));

    expect(screen.getByTestId("invite-preauth")).toHaveAccessibleDescription(description);
  });

  it("keeps the persistent helper alongside the conditional error description", () => {
    renderInvite({ error: "Enter a valid email address.", errorField: "invite" });
    fireEvent.click(screen.getByTestId("invite-open"));

    expect(screen.getByTestId("invite-preauth")).toHaveAttribute(
      "aria-describedby",
      "invite-error-email-help invite-error",
    );
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

  it("renders a pending intended person with explicit non-reservation guidance", () => {
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

    expect(screen.getByTestId("invite-row")).toHaveTextContent("Intended person: Bruce Wayne.");
    expect(screen.getByTestId("invite-row")).toHaveTextContent(
      "This person is not reserved until the invite is accepted.",
    );
  });
});
