import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Resource } from "@capacitylens/shared/types/entities";
import { ResourceMemberActions, type ResourceMemberActionsModel } from "./ResourceMemberActions";
import type { TeamMember } from "../../account/teamAccessClient";

const resource = (overrides: Partial<Resource> = {}) =>
  ({
    id: "person-1",
    accountId: "account-1",
    kind: "person",
    name: "Barbara Gordon",
    role: "Developer",
    employmentType: "permanent",
    engagement: "studio",
    workingHoursPerDay: 8,
    workingDays: [1, 2, 3, 4, 5],
    halfDays: [],
    color: "#3b82f6",
    ...overrides,
  }) as Resource;

const member = (overrides: Partial<TeamMember> = {}) =>
  ({
    userId: "member-1",
    role: "owner",
    status: "active",
    createdAt: "2026-09-01T00:00:00.000Z",
    name: "Barbara Gordon",
    email: "barbara@example.test",
    signInConfirmed: null,
    isSelf: true,
    mayResetPassword: true,
    mayRevokeSessions: true,
    resourceLink: null,
    resourceLinkException: null,
    ...overrides,
  }) as TeamMember;

const model = (members: readonly TeamMember[], canManage = true): ResourceMemberActionsModel => ({
  canManage,
  authMode: "password",
  members,
  reload: vi.fn(),
  directoryError: null,
  contextKey: "account-1\u0000member-1\u0000password\u0000false\u00000",
});

describe("ResourceMemberActions", () => {
  it.each([
    ["placeholder", resource({ kind: "placeholder" })],
    ["external", resource({ kind: "external" })],
    ["archived", resource({ archivedAt: "2026-09-01T00:00:00.000Z" })],
    ["deleted", resource({ deletedAt: "2026-09-01T00:00:00.000Z" })],
  ])("does not expose actions for %s resources", (_label, row) => {
    render(<ResourceMemberActions resource={row} accountId="account-1" model={model([member()])} />);
    expect(screen.queryByTestId("resource-member-actions")).not.toBeInTheDocument();
  });

  it("offers link and invite actions for an unlinked active person", () => {
    render(<ResourceMemberActions resource={resource()} accountId="account-1" model={model([member()])} />);
    expect(screen.getByRole("button", { name: /Link existing member Barbara Gordon/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Invite to company Barbara Gordon/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /View/i })).not.toBeInTheDocument();
  });

  it("offers change and remove for an active link", () => {
    const linked = member({ resourceLink: { resourceId: "person-1", revision: "rev-1", resourceStatus: "active" } });
    render(<ResourceMemberActions resource={resource()} accountId="account-1" model={model([linked])} />);
    expect(screen.getByRole("button", { name: /Change link Barbara Gordon/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove link Barbara Gordon/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Invite to company/i })).not.toBeInTheDocument();
  });

  it("keeps an inactive retained link unlink-only", () => {
    const linked = member({
      status: "disabled",
      resourceLink: { resourceId: "person-1", revision: "rev-1", resourceStatus: "disabled" },
    });
    render(<ResourceMemberActions resource={resource()} accountId="account-1" model={model([linked])} />);
    expect(screen.queryByRole("button", { name: /Change link/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove link Barbara Gordon/i })).toBeInTheDocument();
  });

  it("fails closed when the resolved authorization is not available", () => {
    render(<ResourceMemberActions resource={resource()} accountId="account-1" model={model([member()], false)} />);
    expect(screen.queryByTestId("resource-member-actions")).not.toBeInTheDocument();
  });
});
