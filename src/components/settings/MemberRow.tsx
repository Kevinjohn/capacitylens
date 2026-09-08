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
import { resolveRoleLabel } from "../../lib/accessCopy";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Eye, Pencil, Settings } from "lucide-react";
import type { MemberRoleEdit } from "./MemberConfirmations";
import { resolveMemberLabel, type MemberConfirmationAction } from "./memberConfirmationCopy";

/**
 * Which of a row's controls the viewer may see. Pure and shared by both member tables, so the
 * collapsed inactive group can never end up offering a different set of actions from the main one.
 * The CLIENT gate is courtesy only — the server refuses each of these regardless.
 */
function buildMemberAffordances(
  myRole: Role | undefined,
  member: TeamMember,
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
  const mayTouch = member.status === "active" && !!myRole && canEditAnyMemberRole(myRole, member.role);
  // Remove, by contrast, is status-agnostic on both sides: deleting a non-active membership is a
  // normal administrative act and must not require reinstating it first.
  const mayRemove = !!myRole && canRemoveMember(myRole, member.role);
  const mayChangeStatus = !!myRole && canChangeMemberStatus(myRole, member.role, member.isSelf);
  // Reset links exist only in PASSWORD mode ('sso' delegates credentials to the IdP;
  // the server 400s there regardless) and never for a target an admin can't touch
  // (e.g. an owner, or a member who owns another account — a reset link is an
  // account-takeover capability). We trust the SERVER-computed `mayResetPassword`:
  // it already folds in the cross-account + self-exemption checks the per-account
  // pure guard cannot see AND returns `false` in SSO mode.
  const mayReset = member.mayResetPassword;
  return {
    mayMasquerade: member.status === "active" && !member.isSelf && !!myRole && can(myRole, "masquerade"),
    mayTouch,
    mayRemove,
    mayChangeStatus,
    mayReset,
    hasMenu: mayReset || member.mayRevokeSessions || mayChangeStatus || mayRemove,
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

interface MemberRowActions {
  busy: boolean;
  chooseMemberAction(action: MemberConfirmationAction, member: TeamMember): void;
  setRoleEdit: Dispatch<SetStateAction<MemberRoleEdit | null>>;
}

function MemberIdentity({ member }: { member: TeamMember }) {
  const trimmedName = member.name?.trim();
  let name = member.userId;
  if (trimmedName) name = trimmedName;

  let roleLabel = resolveRoleLabel(member.role);
  if (member.role === "owner") roleLabel = m.settings_member_sole_owner_protected();

  let statusLabel: string | null = null;
  if (member.status === "disabled") statusLabel = m.settings_member_status_disabled();
  if (member.status === "archived") statusLabel = m.settings_member_status_archived();

  return (
    <td className="py-2 pr-3">
      <div className="flex flex-col items-start gap-1">
        <span className="text-ink">
          {name}
          {member.isSelf && <span className="ml-1 text-xs text-muted-foreground">{m.settings_member_you()}</span>}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground" data-testid="member-role">
            {roleLabel}
          </span>
          {statusLabel && (
            <Badge variant="outline" data-testid="member-status">
              {statusLabel}
            </Badge>
          )}
        </div>
      </div>
    </td>
  );
}

function MemberPrimaryActions({
  member,
  memberLabel,
  mayMasquerade,
  mayTouch,
  busy,
  chooseMemberAction,
  setRoleEdit,
}: MemberRowActions & {
  member: TeamMember;
  memberLabel: string;
  mayMasquerade: boolean;
  mayTouch: boolean;
}) {
  return (
    <td className="w-10 py-2 pl-8 text-right">
      {mayMasquerade && (
        <Button
          size="sm"
          variant="ghost"
          title={m.settings_masquerade_aria({ member: memberLabel })}
          aria-label={m.settings_masquerade_aria({ member: memberLabel })}
          data-testid="member-masquerade"
          disabled={busy}
          onClick={() => chooseMemberAction("masquerade", member)}
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
          onClick={() => setRoleEdit({ member: member, nextRole: member.role })}
        >
          <Pencil />
        </Button>
      )}
    </td>
  );
}

function MemberStatusMenuItems({
  member,
  memberLabel,
  chooseMemberAction,
}: {
  member: TeamMember;
  memberLabel: string;
  chooseMemberAction(action: MemberConfirmationAction, member: TeamMember): void;
}) {
  if (member.status !== "active") {
    return (
      <MemberMenuItem
        testId="member-restore"
        label={m.settings_member_restore()}
        ariaLabel={m.settings_member_restore_aria({ member: memberLabel })}
        onSelect={() => chooseMemberAction("restore", member)}
      />
    );
  }
  return (
    <>
      <MemberMenuItem
        testId="member-disable"
        label={m.settings_member_disable()}
        ariaLabel={m.settings_member_disable_aria({ member: memberLabel })}
        onSelect={() => chooseMemberAction("disable", member)}
      />
      <MemberMenuItem
        testId="member-archive"
        label={m.settings_member_archive()}
        ariaLabel={m.settings_member_archive_aria({ member: memberLabel })}
        onSelect={() => chooseMemberAction("archive", member)}
      />
    </>
  );
}

function MemberSettingsMenuItems({
  member,
  memberLabel,
  affordances,
  chooseMemberAction,
}: {
  member: TeamMember;
  memberLabel: string;
  affordances: ReturnType<typeof buildMemberAffordances>;
  chooseMemberAction(action: MemberConfirmationAction, member: TeamMember): void;
}) {
  return (
    <>
      {affordances.mayReset && (
        <MemberMenuItem
          testId="member-reset-password"
          label={m.settings_member_reset_password()}
          ariaLabel={m.settings_member_reset_password_aria({ member: memberLabel })}
          onSelect={() => chooseMemberAction("resetPassword", member)}
        />
      )}
      {member.mayRevokeSessions && (
        <MemberMenuItem
          testId="member-revoke-sessions"
          label={m.settings_member_revoke_sessions()}
          ariaLabel={m.settings_member_revoke_sessions_aria({ member: memberLabel })}
          onSelect={() => chooseMemberAction("revokeSessions", member)}
        />
      )}
      {affordances.mayChangeStatus && (
        <MemberStatusMenuItems member={member} memberLabel={memberLabel} chooseMemberAction={chooseMemberAction} />
      )}
      {affordances.mayRemove && (
        <MemberMenuItem
          testId="member-remove"
          label={m.settings_member_remove()}
          ariaLabel={m.settings_member_remove_aria({ member: memberLabel })}
          danger
          onSelect={() => chooseMemberAction("remove", member)}
        />
      )}
    </>
  );
}

interface MemberSettingsMenuProps {
  member: TeamMember;
  memberLabel: string;
  affordances: ReturnType<typeof buildMemberAffordances>;
  busy: boolean;
  openMenuFor: string | null;
  setOpenMenuFor(value: string | null): void;
  chooseMemberAction(action: MemberConfirmationAction, member: TeamMember): void;
}

function MemberSettingsMenu({
  member,
  memberLabel,
  affordances,
  busy,
  openMenuFor,
  setOpenMenuFor,
  chooseMemberAction,
}: MemberSettingsMenuProps) {
  if (!affordances.hasMenu) return <td className="w-10 py-2 pl-2 text-right" />;
  return (
    <td className="w-10 py-2 pl-2 text-right">
      <Popover
        open={openMenuFor === member.userId}
        onOpenChange={(open) => setOpenMenuFor(open ? member.userId : null)}
      >
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
          <MemberSettingsMenuItems
            member={member}
            memberLabel={memberLabel}
            affordances={affordances}
            chooseMemberAction={chooseMemberAction}
          />
        </PopoverContent>
      </Popover>
    </td>
  );
}

export function MemberRow({
  member: member,
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
  // NB: the row var is `member`, NOT `m` — `m` is the imported i18n message catalogue
  // (P1.5.2); shadowing it would make `m.settings_*()` resolve against the Member.
  const affordances = buildMemberAffordances(myRole, member);
  const memberLabel = resolveMemberLabel(member);
  return (
    <tr className="border-b last:border-b-0" data-testid="member-row">
      <MemberIdentity member={member} />
      <td className="py-2 pr-3 text-muted-foreground" data-testid="member-email">
        {member.email ?? m.settings_member_email_missing()}
      </td>
      {signInTrackingEnabled && (
        <td className="py-2 pr-3 text-muted-foreground" data-testid="member-sign-in-confirmed">
          {member.signInConfirmed ? m.settings_member_sign_in_confirmed() : m.settings_member_sign_in_not_confirmed()}
        </td>
      )}
      <MemberPrimaryActions
        member={member}
        memberLabel={memberLabel}
        mayMasquerade={affordances.mayMasquerade}
        mayTouch={affordances.mayTouch}
        busy={busy}
        chooseMemberAction={chooseMemberAction}
        setRoleEdit={setRoleEdit}
      />
      <MemberSettingsMenu
        member={member}
        memberLabel={memberLabel}
        affordances={affordances}
        busy={busy}
        openMenuFor={openMenuFor}
        setOpenMenuFor={setOpenMenuFor}
        chooseMemberAction={chooseMemberAction}
      />
    </tr>
  );
}
