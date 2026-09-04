import type { Dispatch, SetStateAction } from "react";
import { m } from "@/i18n";
import {
  can,
  canChangeMemberStatus,
  canEditAnyMemberRole,
  canRemoveMember,
  type Role,
} from "@capacitylens/shared/domain/access";
import type { TeamMember } from "../../account/teamAccessClient";
import { roleLabel } from "../../lib/accessCopy";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Eye, Pencil, Settings } from "lucide-react";
import type { MemberRoleEdit } from "./MemberConfirmations";
import { labelFor, type MemberConfirmationAction } from "./memberConfirmationCopy";

/**
 * Which of a row's controls the viewer may see. Pure and shared by both member tables, so the
 * collapsed inactive group can never end up offering a different set of actions from the main one.
 * The CLIENT gate is courtesy only — the server refuses each of these regardless.
 */
function memberAffordances(
  myRole: Role | undefined,
  mem: TeamMember,
): {
  mayMasquerade: boolean;
  mayTouch: boolean;
  mayRemove: boolean;
  mayChangeStatus: boolean;
  mayReset: boolean;
  hasMenu: boolean;
} {
  // The role editor is ACTIVE-only, matching the server: changeMemberRole resolves its target
  // through getActiveMemberRole, so offering the pencil on a non-active row could only ever
  // produce a 404. Restore the member first, then change the role — a role change must not be a
  // back door that quietly reinstates access.
  const mayTouch = mem.status === "active" && !!myRole && canEditAnyMemberRole(myRole, mem.role);
  // Remove, by contrast, is status-agnostic on both sides: deleting a non-active membership is a
  // normal administrative act and must not require reinstating it first.
  const mayRemove = !!myRole && canRemoveMember(myRole, mem.role);
  const mayChangeStatus = !!myRole && canChangeMemberStatus(myRole, mem.role, mem.isSelf);
  // Reset links exist only in PASSWORD mode ('sso' delegates credentials to the IdP;
  // the server 400s there regardless) and never for a target an admin can't touch
  // (e.g. an owner, or a member who owns another account — a reset link is an
  // account-takeover capability). We trust the SERVER-computed `mayResetPassword`:
  // it already folds in the cross-account + self-exemption checks the per-account
  // pure guard cannot see AND returns `false` in SSO mode.
  const mayReset = mem.mayResetPassword;
  return {
    mayMasquerade: mem.status === "active" && !mem.isSelf && !!myRole && can(myRole, "masquerade"),
    mayTouch,
    mayRemove,
    mayChangeStatus,
    mayReset,
    hasMenu: mayReset || mem.mayRevokeSessions || mayChangeStatus || mayRemove,
  };
}

/** One row of the gear popover. A plain button, not a Radix menu item: the popover holds four
 *  actions at most and each one opens a confirmation, so the extra roving-focus machinery of a
 *  full menu would buy nothing. */
function MemberMenuItem({
  label,
  ariaLabel,
  testId,
  danger = false,
  onSelect,
}: {
  label: string;
  ariaLabel: string;
  testId: string;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      data-testid={testId}
      className={`flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent ${danger ? "text-danger" : "text-ink"}`}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

export function MemberRow({
  member: mem,
  myRole,
  signInTrackingEnabled,
  busy,
  openMenuFor,
  setOpenMenuFor,
  setRoleEdit,
  chooseMemberAction,
}: {
  member: TeamMember;
  myRole: Role | undefined;
  signInTrackingEnabled: boolean;
  busy: boolean;
  openMenuFor: string | null;
  setOpenMenuFor(value: string | null): void;
  setRoleEdit: Dispatch<SetStateAction<MemberRoleEdit | null>>;
  chooseMemberAction(action: MemberConfirmationAction, member: TeamMember): void;
}) {
  // One row renderer for both tables: the gear's actions, the pencil's gate and the status badge are
  // identical wherever the row is drawn — only the grouping differs.
  // NB: the row var is `mem`, NOT `m` — `m` is the imported i18n message catalogue
  // (P1.5.2); shadowing it would make `m.settings_*()` resolve against the Member.
  const { mayMasquerade, mayTouch, mayRemove, mayChangeStatus, mayReset, hasMenu } = memberAffordances(myRole, mem);
  const memberLabel = labelFor(mem);
  const name = mem.name?.trim() || mem.userId;
  return (
    <tr className="border-b last:border-b-0" data-testid="member-row">
      <td className="py-2 pr-3">
        <div className="flex flex-col items-start gap-1">
          <span className="text-ink">
            {name}
            {mem.isSelf && <span className="ml-1 text-xs text-muted-foreground">{m.settings_member_you()}</span>}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground" data-testid="member-role">
              {mem.role === "owner" ? m.settings_member_sole_owner_protected() : roleLabel(mem.role)}
            </span>
            {mem.status !== "active" && (
              <Badge variant="outline" data-testid="member-status">
                {mem.status === "disabled" ? m.settings_member_status_disabled() : m.settings_member_status_archived()}
              </Badge>
            )}
          </div>
        </div>
      </td>
      <td className="py-2 pr-3 text-muted-foreground" data-testid="member-email">
        {mem.email ?? m.settings_member_email_missing()}
      </td>
      {signInTrackingEnabled && (
        <td className="py-2 pr-3 text-muted-foreground" data-testid="member-sign-in-confirmed">
          {mem.signInConfirmed ? m.settings_member_sign_in_confirmed() : m.settings_member_sign_in_not_confirmed()}
        </td>
      )}
      <td className="w-10 py-2 pl-8 text-right">
        {mayMasquerade && (
          <Button
            size="sm"
            variant="ghost"
            title={m.settings_masquerade_aria({ member: memberLabel })}
            aria-label={m.settings_masquerade_aria({ member: memberLabel })}
            data-testid="member-masquerade"
            disabled={busy}
            onClick={() => chooseMemberAction("masquerade", mem)}
          >
            <Eye />
          </Button>
        )}
        {mayTouch && (
          <Button
            size="sm"
            variant="ghost"
            title={m.settings_member_edit_aria({ member: memberLabel })}
            aria-label={m.settings_member_edit_aria({ member: memberLabel })}
            data-testid="member-edit"
            disabled={busy}
            onClick={() => setRoleEdit({ member: mem, nextRole: mem.role })}
          >
            <Pencil />
          </Button>
        )}
      </td>
      <td className="w-10 py-2 pl-2 text-right">
        {hasMenu && (
          <Popover open={openMenuFor === mem.userId} onOpenChange={(open) => setOpenMenuFor(open ? mem.userId : null)}>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                title={m.settings_member_settings_aria({ member: memberLabel })}
                aria-label={m.settings_member_settings_aria({ member: memberLabel })}
                data-testid="member-menu"
                disabled={busy}
              >
                <Settings />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-1">
              <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {m.settings_member_settings_heading()}
              </p>
              {mayReset && (
                <MemberMenuItem
                  testId="member-reset-password"
                  label={m.settings_member_reset_password()}
                  ariaLabel={m.settings_member_reset_password_aria({ member: memberLabel })}
                  onSelect={() => chooseMemberAction("resetPassword", mem)}
                />
              )}
              {mem.mayRevokeSessions && (
                <MemberMenuItem
                  testId="member-revoke-sessions"
                  label={m.settings_member_revoke_sessions()}
                  ariaLabel={m.settings_member_revoke_sessions_aria({ member: memberLabel })}
                  onSelect={() => chooseMemberAction("revokeSessions", mem)}
                />
              )}
              {mayChangeStatus &&
                (mem.status === "active" ? (
                  <>
                    <MemberMenuItem
                      testId="member-disable"
                      label={m.settings_member_disable()}
                      ariaLabel={m.settings_member_disable_aria({ member: memberLabel })}
                      onSelect={() => chooseMemberAction("disable", mem)}
                    />
                    <MemberMenuItem
                      testId="member-archive"
                      label={m.settings_member_archive()}
                      ariaLabel={m.settings_member_archive_aria({ member: memberLabel })}
                      onSelect={() => chooseMemberAction("archive", mem)}
                    />
                  </>
                ) : (
                  <MemberMenuItem
                    testId="member-restore"
                    label={m.settings_member_restore()}
                    ariaLabel={m.settings_member_restore_aria({ member: memberLabel })}
                    onSelect={() => chooseMemberAction("restore", mem)}
                  />
                ))}
              {mayRemove && (
                <MemberMenuItem
                  testId="member-remove"
                  label={m.settings_member_remove()}
                  ariaLabel={m.settings_member_remove_aria({ member: memberLabel })}
                  danger
                  onSelect={() => chooseMemberAction("remove", mem)}
                />
              )}
            </PopoverContent>
          </Popover>
        )}
      </td>
    </tr>
  );
}
