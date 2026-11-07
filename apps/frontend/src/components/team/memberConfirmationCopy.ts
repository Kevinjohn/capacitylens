import { m } from '@/i18n';
import type { MembershipStatus } from '@capacitylens/shared/account/types';
import type { TeamMember } from '@/account/teamAccessClient';

/** Member administration actions that require a confirmation message. */
export type MemberConfirmationAction = 'masquerade' | 'suspend' | 'restore';
/** A pending action and its target member. */
export type MemberConfirmation = { kind: MemberConfirmationAction; member: TeamMember };

/** Chooses a non-empty display label for a member confirmation. */
export function resolveMemberLabel(member: TeamMember): string {
  const name = member.name?.trim();
  if (name && member.email) return `${name} (${member.email})`;
  if (name) return name;
  if (member.email) return member.email;
  return member.userId;
}

/** Builds action-specific confirmation wording for the target member. */
export function buildMemberConfirmationCopy({ kind, member }: MemberConfirmation): {
  title: string;
  confirmLabel: string;
  message: string;
} {
  switch (kind) {
    case 'masquerade':
      return {
        title: m.settings_masquerade_title(),
        confirmLabel: m.settings_masquerade_confirm(),
        message: m.settings_masquerade_message({ member: resolveMemberLabel(member) }),
      };
    case 'suspend':
      return {
        title: m.settings_suspend_member_title(),
        confirmLabel: m.settings_member_suspend(),
        message: m.settings_suspend_member_message({ member: resolveMemberLabel(member) }),
      };
    case 'restore':
      return {
        title: m.settings_restore_member_title(),
        confirmLabel: m.settings_member_restore(),
        message: m.settings_restore_member_message({ member: resolveMemberLabel(member) }),
      };
  }
}

/** The status a confirmed lifecycle action writes. Kept beside buildMemberConfirmationCopy so a new action
 * cannot be added to the union without deciding both its wording and its effect. */
export const STATUS_FOR_ACTION: Readonly<Record<'suspend' | 'restore', MembershipStatus>> =
  Object.freeze({ suspend: 'suspended', restore: 'active' });
