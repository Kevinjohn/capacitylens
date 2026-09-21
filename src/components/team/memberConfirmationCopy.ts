import { m } from "@/i18n";
import type { MembershipStatus } from "@capacitylens/shared/account/types";
import { APP_NAME } from "@capacitylens/shared/brand";
import type { TeamMember } from "../../account/teamAccessClient";

// Pure copy and status tables for member confirmations. They live apart from the
// MemberConfirmations component so that file exports only components (react-refresh).
export type MemberConfirmationAction =
  "masquerade" | "remove" | "resetPassword" | "revokeSessions" | "disable" | "archive" | "restore";
export type MemberConfirmation = { kind: MemberConfirmationAction; member: TeamMember };

export function resolveMemberLabel(member: TeamMember): string {
  const name = member.name?.trim();
  if (name && member.email) return `${name} (${member.email})`;
  if (name) return name;
  if (member.email) return member.email;
  return member.userId;
}

export function buildMemberConfirmationCopy({ kind, member }: MemberConfirmation): {
  title: string;
  confirmLabel: string;
  message: string;
} {
  switch (kind) {
    case "masquerade":
      return {
        title: m.settings_masquerade_title(),
        confirmLabel: m.settings_masquerade_confirm(),
        message: m.settings_masquerade_message({ member: resolveMemberLabel(member) }),
      };
    case "remove":
      return {
        title: m.settings_remove_member_title(),
        confirmLabel: m.settings_member_remove(),
        message: member.isSelf
          ? m.settings_remove_self_message()
          : m.settings_remove_member_message({ member: resolveMemberLabel(member) }),
      };
    case "resetPassword":
      return {
        title: m.settings_reset_password_title(),
        confirmLabel: m.settings_member_reset_password(),
        message: m.settings_reset_password_message({ member: resolveMemberLabel(member) }),
      };
    case "revokeSessions":
      return {
        title: m.settings_revoke_sessions_title(),
        confirmLabel: m.settings_member_revoke_sessions(),
        message: member.isSelf
          ? m.settings_revoke_self_sessions_message({ app: APP_NAME })
          : m.settings_revoke_sessions_message({ member: resolveMemberLabel(member), app: APP_NAME }),
      };
    case "disable":
      return {
        title: m.settings_disable_member_title(),
        confirmLabel: m.settings_member_disable(),
        message: m.settings_disable_member_message({ member: resolveMemberLabel(member) }),
      };
    case "archive":
      return {
        title: m.settings_archive_member_title(),
        confirmLabel: m.settings_member_archive(),
        message: m.settings_archive_member_message({ member: resolveMemberLabel(member) }),
      };
    case "restore":
      return {
        title: m.settings_restore_member_title(),
        confirmLabel: m.settings_member_restore(),
        message: m.settings_restore_member_message({ member: resolveMemberLabel(member) }),
      };
  }
}

/** The status a confirmed lifecycle action writes. Kept beside buildMemberConfirmationCopy so a new action
 *  cannot be added to the union without deciding both its wording and its effect. */
export const STATUS_FOR_ACTION: Readonly<Record<"disable" | "archive" | "restore", MembershipStatus>> = Object.freeze({
  disable: "disabled",
  archive: "archived",
  restore: "active",
});
