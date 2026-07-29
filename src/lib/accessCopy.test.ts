import { describe, expect, it } from "vitest";
import type { Role } from "@capacitylens/shared/domain/access";
import { m } from "@/i18n";
import { accessLabelFor, accessSummaryFor, roleLabel, roleSummary } from "./accessCopy";

const roles: Role[] = ["owner", "admin", "editor", "viewer"];

describe("access copy", () => {
  it.each(roles)("maps the %s role to its localized label and summary", (role) => {
    const labels: Record<Role, string> = {
      owner: m.settings_role_owner(),
      admin: m.settings_role_admin(),
      editor: m.settings_role_editor(),
      viewer: m.settings_role_viewer(),
    };
    const summaries: Record<Role, string> = {
      owner: m.access_role_owner_summary(),
      admin: m.access_role_admin_summary(),
      editor: m.access_role_editor_summary(),
      viewer: m.access_role_viewer_summary(),
    };
    expect(roleLabel(role)).toBe(labels[role]);
    expect(roleSummary(role)).toBe(summaries[role]);
  });

  it("applies offline, demo, open, pending, unavailable and role precedence consistently", () => {
    const cases = [
      [
        {
          offlineReadOnly: true,
          experience: "demo",
          permissionStatus: "pending",
          role: "owner",
        },
        m.access_offline_label(),
        m.access_offline_summary(),
      ],
      [
        {
          offlineReadOnly: false,
          experience: "demo",
          permissionStatus: "pending",
          role: null,
        },
        m.access_demo_label(),
        m.access_demo_summary(),
      ],
      [
        {
          offlineReadOnly: false,
          experience: "open",
          permissionStatus: "pending",
          role: null,
        },
        m.access_open_label(),
        m.access_open_summary(),
      ],
      [
        {
          offlineReadOnly: false,
          experience: "authenticated",
          permissionStatus: "pending",
          role: null,
        },
        m.access_checking_label(),
        m.access_checking_summary(),
      ],
      [
        {
          offlineReadOnly: false,
          experience: "authenticated",
          permissionStatus: "not-applicable",
          role: null,
        },
        m.access_not_applicable_label(),
        m.access_not_applicable_summary(),
      ],
      [
        {
          offlineReadOnly: false,
          experience: "authenticated",
          permissionStatus: "unavailable",
          role: "owner",
        },
        m.access_unavailable_label(),
        m.access_unavailable_summary(),
      ],
      [
        {
          offlineReadOnly: false,
          experience: "authenticated",
          permissionStatus: "resolved",
          role: "viewer",
        },
        m.settings_role_viewer(),
        m.access_role_viewer_summary(),
      ],
    ] as const;

    for (const [input, label, summary] of cases) {
      expect(accessLabelFor(input)).toBe(label);
      expect(accessSummaryFor(input)).toBe(summary);
    }
  });
});
