import { describe, expect, it } from "vitest";
import type { Role } from "@capacitylens/shared/domain/access";
import { m } from "@/i18n";
import { resolveAccessLabel, resolveAccessSummary, resolveRoleLabel, resolveRoleSummary } from "./accessCopy";

const roles: Role[] = ["owner", "admin", "editor", "viewer"];

const localizedRoleCopy = (role: Role) => ({
  label: {
    owner: m.settings_role_owner(),
    admin: m.settings_role_admin(),
    editor: m.settings_role_editor(),
    viewer: m.settings_role_viewer(),
  }[role],
  summary: {
    owner: m.access_role_owner_summary(),
    admin: m.access_role_admin_summary(),
    editor: m.access_role_editor_summary(),
    viewer: m.access_role_viewer_summary(),
  }[role],
});

const accessPrecedenceCases = () =>
  [
    [{ experience: "demo", permissionStatus: "pending", role: null }, m.access_demo_label(), m.access_demo_summary()],
    [{ experience: "open", permissionStatus: "pending", role: null }, m.access_open_label(), m.access_open_summary()],
    [
      { experience: "authenticated", permissionStatus: "pending", role: null },
      m.access_checking_label(),
      m.access_checking_summary(),
    ],
    [
      { experience: "authenticated", permissionStatus: "not-applicable", role: null },
      m.access_not_applicable_label(),
      m.access_not_applicable_summary(),
    ],
    [
      { experience: "authenticated", permissionStatus: "unavailable", role: "owner" },
      m.access_unavailable_label(),
      m.access_unavailable_summary(),
    ],
    [
      { experience: "authenticated", permissionStatus: "resolved", role: "viewer" },
      m.settings_role_viewer(),
      m.access_role_viewer_summary(),
    ],
  ] as const;

describe("access copy", () => {
  it.each(roles)("maps the %s role to its localized label and summary", (role) => {
    const copy = localizedRoleCopy(role);
    expect(resolveRoleLabel(role)).toBe(copy.label);
    expect(resolveRoleSummary(role)).toBe(copy.summary);
  });

  it("applies demo, open, pending, unavailable and role precedence consistently", () => {
    for (const [input, label, summary] of accessPrecedenceCases()) {
      expect(resolveAccessLabel(input)).toBe(label);
      expect(resolveAccessSummary(input)).toBe(summary);
    }
  });
});
