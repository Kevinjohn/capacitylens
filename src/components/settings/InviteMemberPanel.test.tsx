import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
    ...overrides,
  };
  return render(<InviteMemberPanel {...props} />);
}

describe("InviteMemberPanel creation guidance", () => {
  it("explains that CapacityLens does not send invitation emails and describes generic versus restricted links", () => {
    renderInvite();

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

    expect(screen.getByTestId("invite-preauth")).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("The invitee must use this email with their verified company login.")).toBeInTheDocument();
  });

  it("keeps the minted link and its recovery instructions in an inline status", () => {
    renderInvite({
      mintedLink: { inviteId: "invite-1", link: "https://app.example/invite/secret" },
    });

    const status = screen.getByTestId("invite-created-status");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveTextContent("Invite created. Copy this link and send it yourself.");
    expect(status).toHaveTextContent("If you lose it, revoke this invite and create a new one.");
    expect(status).toContainElement(screen.getByRole("button", { name: "Copy invitation link" }));
  });
});
