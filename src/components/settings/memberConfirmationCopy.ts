import { m } from "@/i18n";
import type { MembershipStatus } from "@capacitylens/shared/account/types";
import { APP_NAME } from "@capacitylens/shared/brand";
import type { TeamMember } from "../../account/teamAccessClient";

// Pure copy and status tables for member confirmations. They live apart from the
// MemberConfirmations component so that file exports only components (react-refresh).
export type MemberConfirmationAction =
  "masquerade" | "remove" | "resetPassword" | "revokeSessions" | "disable" | "archive" | "restore";
export type MemberConfirmation = { action: MemberConfirmationAction; member: TeamMember };

export function labelFor(m: TeamMember): string {
  const name = m.name?.trim();
  if (name && m.email) return `${name} (${m.email})`;
  return name || m.email || m.userId;
}

export function confirmationCopy({ action, member }: MemberConfirmation): {
  title: string;
  confirmLabel: string;
  message: string;
} {
  switch (action) {
    case "masquerade":
      return {
        title: m.settings_masquerade_title(),
        confirmLabel: m.settings_masquerade_confirm(),
        message: m.settings_masquerade_message({ member: labelFor(member) }),
      };
    case "remove":
      return {
        title: m.settings_remove_member_title(),
        confirmLabel: m.settings_member_remove(),
        message: member.isSelf
          ? m.settings_remove_self_message()
          : m.settings_remove_member_message({ member: labelFor(member) }),
      };
    case "resetPassword":
      return {
        title: m.settings_reset_password_title(),
        confirmLabel: m.settings_member_reset_password(),
        message: m.settings_reset_password_message({ member: labelFor(member) }),
      };
    case "revokeSessions":
      return {
        title: m.settings_revoke_sessions_title(),
        confirmLabel: m.settings_member_revoke_sessions(),
        message: member.isSelf
          ? m.settings_revoke_self_sessions_message({ app: APP_NAME })
          : m.settings_revoke_sessions_message({ member: labelFor(member), app: APP_NAME }),
      };
    case "disable":
      return {
        title: m.settings_disable_member_title(),
        confirmLabel: m.settings_member_disable(),
        message: m.settings_disable_member_message({ member: labelFor(member) }),
      };
    case "archive":
      return {
        title: m.settings_archive_member_title(),
        confirmLabel: m.settings_member_archive(),
        message: m.settings_archive_member_message({ member: labelFor(member) }),
      };
    case "restore":
      return {
        title: m.settings_restore_member_title(),
        confirmLabel: m.settings_member_restore(),
        message: m.settings_restore_member_message({ member: labelFor(member) }),
      };
  }
}

/** The status a confirmed lifecycle action writes. Kept beside confirmationCopy so a new action
 *  cannot be added to the union without deciding both its wording and its effect. */
export const STATUS_FOR_ACTION: Readonly<Record<"disable" | "archive" | "restore", MembershipStatus>> = Object.freeze({
  disable: "disabled",
  archive: "archived",
  restore: "active",
});
